import { state } from "./state.js";
import { $, showScreen, toast } from "./ui/dom.js";
import { initUpload } from "./ui/upload.js";
import { renderReview, countNeedsReview, countNeedsApproval } from "./ui/review.js";
import { runPipeline, PipelineError } from "./pipeline/index.js";
import { buildZip, suggestZipName, triggerDownload } from "./pipeline/zip.js";
import { downloadDiagnosticReport } from "./ui/diagnostics.js";

initUpload(({ file, prefix, checkLookup }) => {
  state.file = file;
  state.prefix = prefix;
  state.checkLookup = checkLookup || null;

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
        toast(`Something Went Wrong: ${err.message || err}`, "bad");
      }
      showScreen("upload");
    });
});

$("btn-restart").addEventListener("click", () => location.reload());

// "…" menu — dev/admin actions that shouldn't clutter the main review flow.
// Open/close on click, dismiss on outside click or Escape. Menu items live in
// HTML so adding new ones is just markup + a wire-up below.
(function initMoreMenu() {
  const btn = $("btn-more");
  const menu = $("more-menu");
  if (!btn || !menu) return;

  const close = () => {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden ? open() : close();
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) close();
  });

  $("btn-export-diag").addEventListener("click", () => {
    close();
    if (!state.bundles || state.bundles.length === 0) {
      toast("No Bundles to Report On.", "bad");
      return;
    }
    try {
      downloadDiagnosticReport(state);
      toast(`Diagnostic Report Downloaded (${state.bundles.length} Bundles).`);
    } catch (err) {
      console.error(err);
      toast(`Report Failed: ${err.message || err}`, "bad");
    }
  });
})();

$("btn-download").addEventListener("click", async () => {
  const btn = $("btn-download");
  const live = state.bundles.filter((b) => !b.skipped);
  if (live.length === 0) {
    toast("Every Bundle Is Skipped — Nothing to Download.", "bad");
    return;
  }
  const pending = countNeedsApproval(live);
  if (pending > 0) {
    const flagged = countNeedsReview(live);
    const pendingTxt =
      pending === 1 ? `1 Bundle Has Not Been Approved` : `${pending} Bundles Have Not Been Approved`;
    const flaggedTxt =
      flagged === 0
        ? ""
        : flagged === 1
          ? ` (1 Still Needs Review)`
          : ` (${flagged} Still Need Review)`;
    if (!confirm(`${pendingTxt}${flaggedTxt}. Download Anyway?`)) return;
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
    toast(`Download Failed: ${err.message || err}`, "bad");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});
