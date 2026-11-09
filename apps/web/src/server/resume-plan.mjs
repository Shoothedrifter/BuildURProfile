import { parseResumePages } from '../lib/resume.ts';
import { normalizePdfTextItems } from '../lib/pdf.ts';
import { validateResumeParsePlan } from '../../../../packages/contracts/src/resume-parse-plan.ts';
import { PDF_MAX_BYTES, resumeError } from '../../../../packages/storage/src/resumes/files.mjs';

const kinds = ['jobIntent', 'selfEvaluation', 'education', 'workExperience', 'projects',
  'awards', 'campusExperience', 'skills', 'other'];

/** Reuse the original browser parser's module and item boundaries as Agent anchors. */
export function planFromPages(pages) {
  const candidate = parseResumePages(pages);
  const entries = [];
  const basicsByPage = new Map();
  for (const field of [candidate.name, candidate.email, ...candidate.basicInfo]) {
    const text = (field === candidate.name ? field?.value : field?.source)?.trim();
    if (!text) continue;
    const page = field.page;
    const existing = basicsByPage.get(page) ?? new Set();
    existing.add(text);
    basicsByPage.set(page, existing);
  }
  for (const [page, sources] of basicsByPage) {
    entries.push({ kind: 'basicInfo', page, text: [...sources].join('\n') });
  }
  for (const kind of kinds) {
    for (const field of candidate[kind]) {
      const text = field.source?.trim();
      if (text) entries.push({ kind, page: field.page, text });
    }
  }
  // A PDF without recognized headings still needs one conservative anchor per page.
  for (let index = 0; index < pages.length; index++) {
    if (!entries.some(entry => entry.page === index + 1) && pages[index].trim()) {
      entries.push({ kind: 'other', page: index + 1, text: pages[index].trim() });
    }
  }
  return validateResumeParsePlan({ version: 'resume-parse-plan-v1',
    anchors: entries.map((entry, index) => ({ anchorId: `a${index}`, ...entry })) });
}

/** The Web service uses the same PDF.js line ordering and browser parser on its stored PDF. */
export async function planFromPdf(pdfBytes) {
  if (!pdfBytes?.length || pdfBytes.length > PDF_MAX_BYTES) throw resumeError(400, 'PARSE_FAILED');
  const { getDocument, VerbosityLevel } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  globalThis.pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const loading = getDocument({ data: new Uint8Array(pdfBytes), isEvalSupported: false,
    useSystemFonts: true, verbosity: VerbosityLevel.ERRORS });
  try {
    const document = await loading.promise;
    if (document.numPages < 1 || document.numPages > 20) throw resumeError(400, 'PARSE_FAILED');
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      pages.push(normalizePdfTextItems((await page.getTextContent()).items));
      page.cleanup();
    }
    return planFromPages(pages);
  } catch (error) {
    if (error.errorCode) throw error;
    throw resumeError(400, 'PARSE_FAILED');
  } finally {
    await loading.destroy();
  }
}
