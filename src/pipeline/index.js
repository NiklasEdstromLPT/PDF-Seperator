import * as pdfjsLib from "pdfjs-dist";
// Vite resolves `?url` to the worker's bundled URL.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { yieldToUi } from "../ui/dom.js";
import { setStage, setProgress } from "../ui/progress.js";
import { detectRedPages } from "./redDetect.js";
import { splitBundles } from "./bundles.js";
import { processBundles } from "./frontPage.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Orchestrate the four stages. Mutates `state` so the review screen has what it needs.
// Throws PipelineError("no-red-pages") for the zero-separators case so the caller can
// show a friendly upload-screen error instead of bailing into the review screen.
export class PipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function runPipeline(state) {
  // Stage 1: read.
  setStage("read");
  setProgress(0, "Opening file…");
  state.pdfBytes = await state.file.arrayBuffer();
  // pdf.js consumes the buffer; pass a copy so state.pdfBytes stays usable for pdf-lib later.
  const loadingTask = pdfjsLib.getDocument({ data: state.pdfBytes.slice(0) });
  state.pdfDoc = await loadingTask.promise;
  const numPages = state.pdfDoc.numPages;
  setProgress(100, `Loaded ${numPages} page${numPages === 1 ? "" : "s"}.`);
  await yieldToUi();

  // Stage 2: detect.
  setStage("detect");
  const redSet = await detectRedPages(state.pdfDoc, state.threshold);

  // Stage 3: split.
  setStage("split");
  setProgress(0, "Grouping pages into bundles…");
  await yieldToUi();
  const groups = splitBundles(numPages, redSet);
  setProgress(100, `${groups.length} bundle${groups.length === 1 ? "" : "s"}.`);
  await yieldToUi();

  if (groups.length === 0) {
    throw new PipelineError(
      "no-red-pages",
      "No Red Separator Pages Found. Check That Dividers Are Present and Try Lowering the Red Threshold."
    );
  }

  // Stage 4: front-page processing (text/OCR + address + thumbnails).
  setStage("ocr");
  state.bundles = await processBundles(state.pdfDoc, groups, {
    checkLookup: state.checkLookup,
  });
}
