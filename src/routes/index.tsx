import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { FileText, Loader2, Send, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askQuestion, ingestDocument, type Source } from "@/lib/rag.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Papermind — Ask your PDFs anything" },
      {
        name: "description",
        content:
          "Upload a PDF and ask questions about it. Papermind finds the relevant passages and answers with the sources it used.",
      },
      { property: "og:title", content: "Papermind — Ask your PDFs anything" },
      {
        property: "og:description",
        content:
          "Upload a PDF and ask questions about it. Papermind finds the relevant passages and answers with the sources it used.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Doc = { id: string; title: string; pageCount: number; chunkCount: number };
type Turn = { question: string; answer: string; sources: Source[] };

function Index() {
  const ingest = useServerFn(ingestDocument);
  const ask = useServerFn(askQuestion);
  const fileInput = useRef<HTMLInputElement>(null);

  const [doc, setDoc] = useState<Doc | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);

  async function handleFile(file: File) {
    setError(null);
    setTurns([]);
    setDoc(null);
    setBusy(true);
    try {
      setStatus("Reading the PDF…");
      const { extractPdf } = await import("@/lib/pdf-text");
      const extracted = await extractPdf(file, (done, total) =>
        setStatus(`Reading page ${done} of ${total}…`),
      );
      if (extracted.chunks.length === 0) {
        throw new Error("No selectable text found in this PDF. Scanned images aren't supported yet.");
      }
      setStatus(`Indexing ${extracted.chunks.length} passages…`);
      const saved = await ingest({
        data: {
          title: file.name.replace(/\.pdf$/i, ""),
          pageCount: extracted.pageCount,
          chunks: extracted.chunks,
        },
      });
      setDoc(saved);
      setStatus(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong reading that PDF.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleAsk(event: React.FormEvent) {
    event.preventDefault();
    if (!doc || !question.trim() || asking) return;
    const asked = question.trim();
    setQuestion("");
    setAsking(true);
    setError(null);
    try {
      const result = await ask({ data: { documentId: doc.id, question: asked } });
      setTurns((prev) => [...prev, { question: asked, answer: result.answer, sources: result.sources }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't answer that question.");
      setQuestion(asked);
    } finally {
      setAsking(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-14">
      <header className="text-center">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Papermind</p>
        <h1 className="mt-3 text-5xl leading-tight text-foreground sm:text-6xl">
          Ask your PDF <em className="text-accent">anything</em>
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
          Drop in a document. Every answer comes back with the passages it was drawn from.
        </p>
      </header>

      <section className="panel mt-10 p-6">
        {doc ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                <FileText className="size-5" />
              </span>
              <div>
                <p className="font-medium">{doc.title}</p>
                <p className="text-xs text-muted-foreground">
                  {doc.pageCount} pages · {doc.chunkCount} passages indexed
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}>
              Replace PDF
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="flex w-full flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center transition-colors hover:bg-secondary/60 disabled:opacity-70"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
              {busy ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
            </span>
            <span className="display-title text-2xl">{busy ? "Working…" : "Choose a PDF"}</span>
            <span className="text-xs text-muted-foreground">
              {status ?? "Text-based PDFs up to a few hundred pages"}
            </span>
          </button>
        )}

        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </section>

      {error ? (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {doc ? (
        <>
          <form onSubmit={handleAsk} className="mt-6 flex gap-2">
            <Input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What does this document say about…?"
              className="h-12 bg-card text-base"
              disabled={asking}
            />
            <Button type="submit" size="lg" className="h-12 px-5" disabled={asking || !question.trim()}>
              {asking ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </form>

          <div className="mt-8 space-y-6">
            {turns.map((turn, index) => (
              <article key={index} className="panel p-6">
                <h2 className="text-2xl">{turn.question}</h2>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {turn.answer}
                </p>
                {turn.sources.length > 0 ? (
                  <div className="mt-5 border-t border-border pt-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Sources</p>
                    <ol className="mt-3 space-y-3">
                      {turn.sources.map((source, sourceIndex) => (
                        <li key={sourceIndex} className="rounded-lg bg-secondary/70 px-4 py-3">
                          <p className="text-xs font-medium text-secondary-foreground">
                            [{sourceIndex + 1}] Page {source.page ?? "?"} ·{" "}
                            {Math.round(source.similarity * 100)}% match
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {source.content.slice(0, 320)}
                            {source.content.length > 320 ? "…" : ""}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </article>
            ))}
            {asking ? (
              <p className="text-sm text-muted-foreground">Searching the document…</p>
            ) : turns.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ask your first question — answers cite the pages they came from.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </main>
  );
}
