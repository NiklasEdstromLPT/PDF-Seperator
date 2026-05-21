import { state } from "./state.js";
import { $, showScreen, toast } from "./ui/dom.js";
import { initUpload } from "./ui/upload.js";
import { renderReview, countNeedsReview, countNeedsApproval, bundleCountMismatch } from "./ui/review.js";
import { runPipeline, PipelineError } from "./pipeline/index.js";
import { buildZip, suggestZipName, triggerDownload } from "./pipeline/zip.js";
import { downloadDiagnosticReport } from "./ui/diagnostics.js";

initUpload(({ file, prefix, checkLookup, expectedBundles }) => {
  state.file = file;
  state.prefix = prefix;
  state.checkLookup = checkLookup || null;
  state.expectedBundles = expectedBundles ?? null;

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

// "How It Works" page — opens from the header link, remembers which screen
// the user came from so Back returns them mid-task (e.g. mid-review) instead
// of dumping them back at upload.
(function initHowItWorks() {
  const openBtn = $("btn-how-it-works");
  const backBtn = $("btn-hiw-back");
  if (!openBtn || !backBtn) return;
  let returnTo = "upload";
  openBtn.addEventListener("click", () => {
    const current = document.querySelector(".screen.active");
    if (current && current.id !== "screen-how-it-works") {
      returnTo = current.id.replace(/^screen-/, "");
    }
    showScreen("how-it-works");
    window.scrollTo({ top: 0 });
  });
  backBtn.addEventListener("click", () => {
    showScreen(returnTo);
  });
})();

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
  // Collect every active disclaimer into one confirm dialog so the user sees
  // the full picture before deciding to download. Mirrors the on-screen
  // banners (mismatch → pending → critical review) so wording stays
  // consistent across the two surfaces.
  const warnings = [];
  // Suppress the mismatch line when the user has dismissed the banner —
  // dismissing == "yes, I've seen it, move on". The other warnings
  // (pending / critical review) stay in scope because those track per-card
  // approval, not a one-time acknowledgment.
  const mismatch = state.mismatchDismissed ? null : bundleCountMismatch(state);
  if (mismatch) {
    const verb = mismatch.actual < mismatch.expected ? "Only" : "But";
    const noun = mismatch.actual === 1 ? "Bundle" : "Bundles";
    warnings.push(
      `You Expected ${mismatch.expected} Bundles, ${verb} ${mismatch.actual} ${noun} Were Detected.`,
    );
  }
  const pending = countNeedsApproval(live);
  if (pending > 0) {
    warnings.push(
      pending === 1 ? "1 Bundle Is Pending Approval" : `${pending} Bundles Are Pending Approval`,
    );
  }
  const flagged = countNeedsReview(live);
  if (flagged > 0) {
    warnings.push(
      flagged === 1 ? "1 Bundle Needs Critical Review" : `${flagged} Bundles Need Critical Review`,
    );
  }
  if (warnings.length > 0) {
    if (!confirm(`${warnings.join("\n")}\n\nDownload Anyway?`)) return;
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
