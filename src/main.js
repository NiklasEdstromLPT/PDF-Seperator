import { state } from "./state.js";
import { $, showScreen, toast } from "./ui/dom.js";
import { initUpload } from "./ui/upload.js";
import { renderReview } from "./ui/review.js";
import { runPipeline, PipelineError } from "./pipeline/index.js";
import { buildZip, suggestZipName, triggerDownload } from "./pipeline/zip.js";

initUpload(({ file, prefix }) => {
  state.file = file;
  state.prefix = prefix;

  showScreen("progress");
  runPipeline(state)
    .then(() => {
      renderReview(state);
      showScreen("review");
    })
    .catch((err) => {
      if (err instanceof PipelineError && err.code === "no-red-pages") {
        toast(err.message, "bad");
      } else {
        console.error(err);
        toast(`Something went wrong: ${err.message || err}`, "bad");
      }
      showScreen("upload");
    });
});

$("btn-restart").addEventListener("click", () => location.reload());

$("btn-download").addEventListener("click", async () => {
  const btn = $("btn-download");
  const live = state.bundles.filter((b) => !b.skipped);
  if (live.length === 0) {
    toast("Every bundle is skipped — nothing to download.", "bad");
    return;
  }
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Building ZIP…";
  try {
    const blob = await buildZip(state.pdfBytes, live, state.prefix);
    triggerDownload(blob, suggestZipName());
    toast(`Downloaded ${live.length} PDF${live.length === 1 ? "" : "s"}.`);
  } catch (err) {
    console.error(err);
    toast(`Download failed: ${err.message || err}`, "bad");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});
