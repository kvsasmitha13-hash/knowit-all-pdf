import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const EMBEDDING_MODEL = "google/gemini-embedding-2";
const CHAT_MODEL = "google/gemini-3.8-flash";
const MAX_BATCH = 100;

function apiKey() {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured yet. Please try again in a moment.");
  return key;
}

function gatewayError(status: number, body: string) {
  if (status === 402) return new Error("The AI credits for this app have run out.");
  if (status === 429) return new Error("Too many requests right now — please try again shortly.");
  return new Error(`AI request failed (${status}): ${body.slice(0, 300)}`);
}

async function embed(inputs: string[], key: string): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < inputs.length; i += MAX_BATCH) {
    const batch = inputs.slice(i, i + MAX_BATCH);
    const response = await fetch(`${GATEWAY}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
    });
    if (!response.ok) throw gatewayError(response.status, await response.text());
    const result = (await response.json()) as { data: { index: number; embedding: number[] }[] };
    const ordered: (number[] | undefined)[] = Array.from({ length: batch.length });
    for (const item of result.data) ordered[item.index] = item.embedding;
    for (const vector of ordered) {
      if (!vector?.length) throw new Error("The document could not be indexed. Please try again.");
      vectors.push(vector);
    }
  }
  return vectors;
}

const IngestInput = z.object({
  title: z.string().min(1).max(300),
  pageCount: z.number().int().min(1).max(5000),
  chunks: z
    .array(z.object({ content: z.string().min(1).max(8000), page: z.number().int().min(1) }))
    .min(1)
    .max(2000),
});

export const ingestDocument = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => IngestInput.parse(input))
  .handler(async ({ data }) => {
    const key = apiKey();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const vectors = await embed(
      data.chunks.map((chunk) => chunk.content),
      key,
    );

    const { data: document, error: documentError } = await supabaseAdmin
      .from("pdf_documents")
      .insert({
        title: data.title,
        page_count: data.pageCount,
        chunk_count: data.chunks.length,
      })
      .select("id, title, page_count, chunk_count")
      .single();
    if (documentError || !document) throw new Error(documentError?.message ?? "Could not save the document.");

    const rows = data.chunks.map((chunk, index) => ({
      document_id: document.id,
      chunk_index: index,
      page: chunk.page,
      content: chunk.content,
      embedding: JSON.stringify(vectors[index]),
    }));

    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabaseAdmin.from("pdf_chunks").insert(rows.slice(i, i + 200));
      if (error) throw new Error(error.message);
    }

    return {
      id: document.id,
      title: document.title,
      pageCount: document.page_count,
      chunkCount: document.chunk_count,
    };
  });

const AskInput = z.object({
  documentId: z.string().uuid(),
  question: z.string().min(2).max(1000),
});

export type Source = {
  page: number | null;
  similarity: number;
  content: string;
};

export const askQuestion = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AskInput.parse(input))
  .handler(async ({ data }) => {
    const key = apiKey();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [queryVector] = await embed([data.question], key);

    const { data: matches, error } = await supabaseAdmin.rpc("match_pdf_chunks", {
      p_document_id: data.documentId,
      query_embedding: JSON.stringify(queryVector),
      match_count: 6,
    });
    if (error) throw new Error(error.message);

    const sources: Source[] = (matches ?? []).map((match) => ({
      page: match.page ?? null,
      similarity: match.similarity,
      content: match.content,
    }));

    if (sources.length === 0) {
      return { answer: "I couldn't find anything in this document to answer that.", sources };
    }

    const context = sources
      .map((source, index) => `[${index + 1}] (page ${source.page ?? "?"})\n${source.content}`)
      .join("\n\n");

    const response = await fetch(`${GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You answer questions using only the numbered excerpts from a PDF provided by the user. " +
              "Cite the excerpts you used inline like [1] or [2]. If the excerpts do not contain the answer, " +
              "say so plainly instead of guessing. Keep answers concise and concrete.",
          },
          { role: "user", content: `Excerpts:\n\n${context}\n\nQuestion: ${data.question}` },
        ],
      }),
    });
    if (!response.ok) throw gatewayError(response.status, await response.text());

    const result = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const answer = result.choices?.[0]?.message?.content?.trim();

    return {
      answer: answer && answer.length > 0 ? answer : "The model returned an empty answer. Please rephrase.",
      sources,
    };
  });
