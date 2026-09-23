// Browser-only: extract text from a PDF file and split it into overlapping chunks.
export type PdfChunk = { content: string; page: number };

export type ExtractedPdf = {
  pageCount: number;
  chunks: PdfChunk[];
};

const CHUNK_CHARS = 1400;
const CHUNK_OVERLAP = 220;

function chunkPage(text: string, page: number): PdfChunk[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const chunks: PdfChunk[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_CHARS, clean.length);
    if (end < clean.length) {
      const breakAt = clean.lastIndexOf(". ", end);
      if (breakAt > start + CHUNK_CHARS * 0.5) end = breakAt + 1;
    }
    const slice = clean.slice(start, end).trim();
    if (slice) chunks.push({ content: slice, page });
    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks;
}

export async function extractPdf(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractedPdf> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  if (data.byteLength === 0) {
    throw new Error("That file came through empty. Try choosing it again.");
  }
  const header = String.fromCharCode(...data.slice(0, 5));
  if (!header.startsWith("%PDF")) {
    throw new Error("That file doesn't look like a PDF. Please choose a .pdf file.");
  }

  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  } catch {
    throw new Error(
      "This PDF couldn't be opened — it may be damaged or password protected. Try re-saving or exporting it again.",
    );
  }

  const chunks: PdfChunk[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    chunks.push(...chunkPage(text, pageNumber));
    onProgress?.(pageNumber, pdf.numPages);
  }

  return { pageCount: pdf.numPages, chunks };
}
