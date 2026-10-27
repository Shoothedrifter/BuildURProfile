import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

type PdfTextItem =
  | { str: string; hasEOL: boolean; transform?: number[] }
  | { type: string; id?: string };

/** Reorder complete lines by page position because PDF drawing order can group headings apart from their content. */
export function normalizePdfTextItems(items: readonly PdfTextItem[]): string {
  const lines: { text: string; x?: number; y?: number }[] = [];
  let line = "";
  let linePosition: { x: number; y: number } | undefined;

  const finishLine = () => {
    const normalized = line.replace(/\s+/g, " ").trim();
    if (normalized) lines.push({ text: normalized, ...linePosition });
    line = "";
    linePosition = undefined;
  };

  for (const item of items) {
    if (!("str" in item)) continue;
    if (!linePosition && item.str.trim() && item.transform?.length === 6) {
      linePosition = { x: item.transform[4], y: item.transform[5] };
    }
    line += item.str;
    if (item.hasEOL) finishLine();
  }

  finishLine();
  if (lines.every((entry) => entry.x !== undefined && entry.y !== undefined)) {
    lines.sort((a, b) => Math.abs(b.y! - a.y!) < 0.5 ? a.x! - b.x! : b.y! - a.y!);
  }
  return lines.map((entry) => entry.text).join("\n");
}

export async function extractPdfText(
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<{ pages: string[]; text: string }> {
  // Only the worker script is fetched from this app; PDF bytes stay in browser memory.
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = new Uint8Array(await file.arrayBuffer());
  // Some embedded fonts are malformed and can emit thousands of benign parser warnings.
  const loadingTask = pdfjs.getDocument({ data, verbosity: pdfjs.VerbosityLevel.ERRORS });
  let document: PDFDocumentProxy | null = null;

  try {
    document = await loadingTask.promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(normalizePdfTextItems(content.items));
      onProgress?.(pageNumber, document.numPages);
    }

    return { pages, text: pages.filter(Boolean).join("\n\n") };
  } finally {
    try {
      await document?.cleanup();
    } finally {
      await loadingTask.destroy();
    }
  }
}
