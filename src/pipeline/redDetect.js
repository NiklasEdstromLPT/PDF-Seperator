import { yieldToUi } from "../ui/dom.js";
import { setProgress } from "../ui/progress.js";

const SCALE = 0.25;
const SAMPLE_STEP = 4;

// Returns a Set of 0-based page indices judged to be red separators.
export async function detectRedPages(pdfDoc, thresholdPct) {
  const numPages = pdfDoc.numPages;
  const red = new Set();

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    await page.render({ canvasContext: ctx, viewport }).promise;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (isRedPage(img, SAMPLE_STEP, thresholdPct)) red.add(i - 1);
    page.cleanup();

    setProgress((i / numPages) * 100, `Page ${i} of ${numPages}`);
    if (i % 4 === 0) await yieldToUi();
  }
  return red;
}

// Sample every Nth pixel; ignore near-white and near-black; classify red-dominant
// pixels and return true when their share of the considered pixels meets the threshold.
export function isRedPage(imageData, step, thresholdPct) {
  const { data, width, height } = imageData;
  let total = 0;
  let red = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 240 && g > 240 && b > 240) continue;
      if (r < 30 && g < 30 && b < 30) continue;
      total++;
      if (r > 100 && r > g + 40 && r > b + 40) red++;
    }
  }
  if (total === 0) return false;
  return (red / total) * 100 >= thresholdPct;
}
