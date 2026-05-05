import { createWorker } from "tesseract.js";
import { yieldToUi } from "../ui/dom.js";
import { setProgress } from "../ui/progress.js";
import { extractAddress } from "./address.js";

// Thumbnails are kept in memory for the review screen only (session-scoped),
// so render generously: 1.5x base, bumped to devicePixelRatio on retina/HiDPI
// displays. Saved as PNG for crisp text — JPEG smears small print at any quality.
const THUMB_SCALE = Math.max(1.5, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
const OCR_SCALE = 2;
const TEXT_MIN_CHARS = 30;

// Lazily created Tesseract worker; reused across all bundles, terminated at end.
let tesseractWorker = null;
async function getTesseract() {
  if (!tesseractWorker) tesseractWorker = await createWorker("eng");
  return tesseractWorker;
}
async function teardownTesseract() {
  if (!tesseractWorker) return;
  try { await tesseractWorker.terminate(); } catch (_) {}
  tesseractWorker = null;
}

// Process each bundle's front page: render thumbnail, extract text (embedded first,
// OCR fallback), pull a candidate address.
export async function processBundles(pdfDoc, groups) {
  const bundles = [];
  try {
    for (let i = 0; i < groups.length; i++) {
      const pages = groups[i];
      const front = await pdfDoc.getPage(pages[0] + 1); // pdf.js is 1-based

      const thumbnail = await renderThumbnail(front);
      const text = await extractText(front);
      front.cleanup();

      const address = extractAddress(text);

      bundles.push({
        index: i,
        pages,
        thumbnail,
        address,
        addressDetected: !!address,
        skipped: false,
      });

      setProgress(((i + 1) / groups.length) * 100, `Bundle ${i + 1} of ${groups.length}`);
      await yieldToUi();
    }
  } finally {
    await teardownTesseract();
  }
  return bundles;
}

async function renderThumbnail(page) {
  const vp = page.getViewport({ scale: THUMB_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
  return canvas.toDataURL("image/png");
}

async function extractText(page) {
  let text = "";
  try {
    const tc = await page.getTextContent();
    text = tc.items.map((it) => it.str).join(" ");
  } catch (_) {
    text = "";
  }

  if (text.replace(/\s+/g, "").length >= TEXT_MIN_CHARS) return text;

  // Fallback: OCR the front page at high resolution.
  const vp = page.getViewport({ scale: OCR_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;

  const worker = await getTesseract();
  const { data } = await worker.recognize(canvas);
  return data.text || "";
}
