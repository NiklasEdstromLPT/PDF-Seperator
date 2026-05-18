import { createWorker } from "tesseract.js";
import { yieldToUi } from "../ui/dom.js";
import { setProgress } from "../ui/progress.js";
import { extractAddress, traceAddressScan } from "./address.js";
import { extractCheckNumber, findCandidateInString } from "./checkNumber.js";
import { buildNameBody } from "./filename.js";
import { applyCheckLookup } from "./checkLookup.js";

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
// digit candidates, pull a candidate address and check number, locate the
// extracted values back in the page tokens for highlighter overlays.
//
// opts.checkLookup (optional): a buildCheckLookup() result. When present and a
// bundle's auto-detected check# matches a row in the pasted spreadsheet, that
// row's address replaces the OCR address. Exact matches keep strong
// confidence; fuzzy matches drop to weak so the bundle still gets flagged
// for human review.
export async function processBundles(pdfDoc, groups, opts = {}) {
  const { checkLookup = null } = opts;
  const bundles = [];
  try {
    for (let i = 0; i < groups.length; i++) {
      const pages = groups[i];
      const front = await pdfDoc.getPage(pages[0] + 1); // pdf.js is 1-based

      const thumbnail = await renderThumbnail(front);
      const { text, candidates, tokens, textSource } = await extractTextAndCandidates(front);
      front.cleanup();

      const ocrAddress = extractAddress(text);
      const checkNumber = extractCheckNumber(text, candidates);
      // Diagnostic snapshot — captured for every bundle so the dev-mode
      // "export diagnostic report" can explain why detection landed where it
      // did. Pure observation; nothing here affects production output.
      const addressTrace = traceAddressScan(text);

      // Spreadsheet override. We only attempt the lookup when OCR produced a
      // usable check#; without one there's nothing to key on. The lookup
      // either replaces both the address and the confidence, or leaves them
      // alone.
      const resolved = applyCheckLookup({
        checkNumber,
        ocrAddress,
        lookup: checkLookup,
      });
      const address = resolved.address;
      const confidence = resolved.confidence;

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
        // "ocr" | "spreadsheet" | "spreadsheet-fuzzy" — drives the review
        // pill text so reviewers can see at a glance where an address came
        // from. Spreadsheet-fuzzy matches always sit in the weak/amber tier.
        addressSource: resolved.source,
        addressLookupMatch: resolved.match || null,
        checkNumber,
        nameBody: buildNameBody(checkNumber, address),
        // Bbox percentages (0-100, top-left origin) of where the auto-detected
        // values were located on the page. Powers the review-screen highlighter
        // overlay; null fields just don't render. DOM-only — never reaches the
        // exported PDF.
        highlights: {
          check: locateValueBbox(tokens, checkNumber, "rightmost"),
          address: locateValueBbox(tokens, address, "tightest"),
        },
        skipped: false,
        diagnostics: {
          textSource,
          rawText: text || "",
          rawTextLen: (text || "").length,
          candidatesCount: candidates.length,
          tokensCount: tokens.length,
          addressTrace,
          ocrAddress,
          resolved,
        },
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

// Returns { text, candidates, tokens }.
//   text: full-page text used by address extraction and the banner-form check
//         number regex.
//   candidates: positional digit-run candidates used by check-number ranking.
//               Each entry is { value, x, y } where higher x = further right
//               and higher y = further up the page (consistent across both
//               the embedded-text and OCR paths so checkNumber.js can sort
//               uniformly).
//   tokens: every page word/run with `{ str, bbox: {x,y,w,h} }` where bbox
//           coords are percentages of the page in viewport (top-left origin)
//           orientation. Used by the highlighter overlay to locate a matched
//           value back on the rendered thumbnail.
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
    const [pageWidth, pageHeight] = pageDims(page);
    return {
      text,
      candidates: candidatesFromTextItems(items),
      tokens: tokensFromTextItems(items, pageWidth, pageHeight),
      textSource: "embedded-text",
    };
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
    tokens: tokensFromTesseractWords(data.words || [], canvas.width, canvas.height),
    textSource: "ocr",
  };
}

function pageDims(page) {
  // page.view = [x0, y0, x1, y1] in PDF user-space units.
  const v = page.view || [0, 0, 612, 792];
  return [v[2] - v[0], v[3] - v[1]];
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

// Convert PDF.js text items into screen-relative tokens. PDF coords have a
// bottom-left origin; we flip y so the bbox is in viewport (top-left) space
// expressed as percentages of the page, matching how the thumbnail is rendered.
function tokensFromTextItems(items, pageWidth, pageHeight) {
  if (!pageWidth || !pageHeight) return [];
  const out = [];
  for (const it of items) {
    const x = it.transform[4];
    const yBaseline = it.transform[5];
    const w = it.width || 0;
    // PDF.js item.height is the rendered glyph height; transform[3] is the
    // font scale. Either is a reasonable bbox height.
    const h = it.height || Math.abs(it.transform[3]) || 12;
    out.push({
      str: it.str || "",
      bbox: {
        x: (x / pageWidth) * 100,
        y: ((pageHeight - yBaseline - h) / pageHeight) * 100,
        w: (w / pageWidth) * 100,
        h: (h / pageHeight) * 100,
      },
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

// Tesseract words → tokens. bbox is already top-left origin in canvas pixels,
// so the conversion is just normalize-to-percent.
function tokensFromTesseractWords(words, canvasW, canvasH) {
  if (!canvasW || !canvasH) return [];
  const out = [];
  for (const w of words) {
    if (!w.bbox) continue;
    const { x0, y0, x1, y1 } = w.bbox;
    out.push({
      str: w.text || "",
      bbox: {
        x: (x0 / canvasW) * 100,
        y: (y0 / canvasH) * 100,
        w: ((x1 - x0) / canvasW) * 100,
        h: ((y1 - y0) / canvasH) * 100,
      },
    });
  }
  return out;
}

// Find a contiguous span of tokens whose joined text contains `value`, then
// return the union bbox in page-percent coordinates.
//
// `prefer`:
//   "first"     — earliest match in document order.
//   "rightmost" — the match whose union bbox starts furthest right (used for
//                 the check number, which prints in the top-right of the check).
//   "tightest"  — match with the smallest union-bbox area (default for the
//                 address). Addresses commonly appear twice — once on its own
//                 line in the closing summary ("8995 Magnolia Park") and once
//                 embedded inside the memo line on the check body
//                 ("Commissions / 8995 Magnolia Park, Houston, TX 77002").
//                 The bare summary line is a much tighter rectangle, so
//                 "tightest" reliably picks it without us having to know
//                 which way the page laid out the two blocks.
export function locateValueBbox(tokens, value, prefer = "tightest") {
  const target = norm(value);
  if (!target || !tokens || tokens.length === 0) return null;

  const matches = [];
  for (let i = 0; i < tokens.length; i++) {
    let joined = "";
    for (let j = i; j < tokens.length; j++) {
      joined += (joined ? " " : "") + (tokens[j].str || "");
      if (norm(joined).includes(target)) {
        matches.push(tokens.slice(i, j + 1));
        break; // smallest window starting at this i
      }
    }
  }
  if (!matches.length) return null;

  let chosen;
  if (prefer === "rightmost") {
    chosen = matches.reduce((best, span) => {
      const bx = unionBbox(span);
      const cx = unionBbox(best);
      return bx && cx && bx.x > cx.x ? span : best;
    });
  } else if (prefer === "tightest") {
    chosen = matches.reduce((best, span) => {
      const ba = bboxArea(unionBbox(span));
      const ca = bboxArea(unionBbox(best));
      return ba < ca ? span : best;
    });
  } else {
    chosen = matches[0];
  }

  return unionBbox(chosen);
}

function bboxArea(b) {
  return b ? Math.max(0, b.w) * Math.max(0, b.h) : Infinity;
}

function norm(s) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function unionBbox(span) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of span) {
    if (!t.bbox) continue;
    minX = Math.min(minX, t.bbox.x);
    minY = Math.min(minY, t.bbox.y);
    maxX = Math.max(maxX, t.bbox.x + t.bbox.w);
    maxY = Math.max(maxY, t.bbox.y + t.bbox.h);
  }
  if (!isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
