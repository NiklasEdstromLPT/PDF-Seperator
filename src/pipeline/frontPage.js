import { createWorker } from "tesseract.js";
import { yieldToUi } from "../ui/dom.js";
import { setProgress } from "../ui/progress.js";
import { extractAddress } from "./address.js";
import { extractCheckNumber, findCandidateInString } from "./checkNumber.js";
import { buildNameBody } from "./filename.js";

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

// Process each bundle's front page: render thumbnail, extract text + positional
// digit candidates, pull a candidate address and check number.
export async function processBundles(pdfDoc, groups) {
  const bundles = [];
  try {
    for (let i = 0; i < groups.length; i++) {
      const pages = groups[i];
      const front = await pdfDoc.getPage(pages[0] + 1); // pdf.js is 1-based

      const thumbnail = await renderThumbnail(front);
      const { text, candidates } = await extractTextAndCandidates(front);
      front.cleanup();

      const { value: address, confidence } = extractAddress(text);
      const checkNumber = extractCheckNumber(text, candidates);

      bundles.push({
        index: i,
        pages,
        thumbnail,
        address,
        // True only for strong matches. Weak matches still need human verification,
        // so they propagate through the existing needsReview() gate as if they
        // hadn't been auto-detected.
        addressDetected: confidence === "strong",
        addressConfidence: confidence,
        checkNumber,
        nameBody: buildNameBody(checkNumber, address),
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

// Returns { text, candidates }.
//   text: full-page text used by address extraction and the banner-form check
//         number regex.
//   candidates: positional digit-run candidates used by check-number ranking.
//               Each entry is { value, x, y } where higher x = further right
//               and higher y = further up the page (consistent across both
//               the embedded-text and OCR paths so checkNumber.js can sort
//               uniformly).
async function extractTextAndCandidates(page) {
  // Try the embedded text layer first.
  let text = "";
  let items = [];
  try {
    const tc = await page.getTextContent();
    items = tc.items;
    text = items.map((it) => it.str).join(" ");
  } catch (_) {
    text = "";
    items = [];
  }

  if (text.replace(/\s+/g, "").length >= TEXT_MIN_CHARS) {
    return { text, candidates: candidatesFromTextItems(items) };
  }

  // Fall back to OCR. Render the page at 2x and ask Tesseract for word-level
  // results (text + bounding boxes).
  const vp = page.getViewport({ scale: OCR_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;

  const worker = await getTesseract();
  const { data } = await worker.recognize(canvas);
  return {
    text: data.text || "",
    candidates: candidatesFromTesseractWords(data.words || []),
  };
}

// PDF.js text items: transform[4] is x, transform[5] is y (PDF coords are
// bottom-up so higher y = further up the page — already what we want).
function candidatesFromTextItems(items) {
  const out = [];
  for (const it of items) {
    const value = findCandidateInString(it.str);
    if (!value) continue;
    out.push({
      value,
      x: it.transform[4],
      y: it.transform[5],
    });
  }
  return out;
}

// Tesseract words: bbox is { x0, y0, x1, y1 } in image coordinates (top-down,
// so smaller y = higher on the page). Negate y so "higher = further up"
// matches the PDF.js convention for sorting.
function candidatesFromTesseractWords(words) {
  const out = [];
  for (const w of words) {
    const value = findCandidateInString(w.text);
    if (!value || !w.bbox) continue;
    out.push({
      value,
      x: w.bbox.x1, // right edge of the word for rightmost ranking
      y: -w.bbox.y0,
    });
  }
  return out;
}
