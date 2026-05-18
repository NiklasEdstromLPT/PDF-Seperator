import { $, toast } from "./dom.js";
import { parsePastedRows, buildCheckLookup } from "../pipeline/checkLookup.js";

// Wire the drop zone, file picker, settings inputs, and the optional
// spreadsheet-paste step.
//
// onFile receives ({ file, prefix, checkLookup }) and is responsible for
// kicking off the pipeline. checkLookup is null when the user didn't paste
// anything; otherwise it's the object returned by buildCheckLookup().
export function initUpload(onFile) {
  const drop = $("drop");
  const fileInput = $("file-input");

  // Spreadsheet paste — re-parsed on every keystroke so the status line gives
  // immediate feedback ("38 rows recognized", or a warning about missing
  // columns). Latest parse is captured in this closure and forwarded along
  // when the user finally drops a PDF.
  const pasteEl = $("spreadsheet-paste");
  const statusEl = $("spreadsheet-status");
  const clearBtn = $("spreadsheet-clear");
  const detailsEl = $("spreadsheet-details");
  let currentLookup = null;

  function refreshSpreadsheet() {
    const raw = pasteEl ? pasteEl.value : "";
    if (!raw || !raw.trim()) {
      currentLookup = null;
      if (statusEl) {
        statusEl.textContent = "";
        statusEl.className = "spreadsheet-status";
      }
      return;
    }
    const { rows, warnings } = parsePastedRows(raw);
    currentLookup = buildCheckLookup(rows);
    if (!statusEl) return;
    if (rows.length === 0) {
      statusEl.className = "spreadsheet-status bad";
      statusEl.textContent =
        (warnings[0] || "Couldn't parse the pasted data.");
      return;
    }
    const word = rows.length === 1 ? "row" : "rows";
    const tail = warnings.length ? ` · ${warnings.join(" ")}` : "";
    statusEl.className = "spreadsheet-status ok";
    statusEl.textContent = `Loaded ${rows.length} ${word} from spreadsheet.${tail}`;
  }

  if (pasteEl) {
    pasteEl.addEventListener("input", refreshSpreadsheet);
    pasteEl.addEventListener("paste", () => {
      // The DOM hasn't taken the paste yet at this point — defer.
      setTimeout(refreshSpreadsheet, 0);
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (pasteEl) pasteEl.value = "";
      refreshSpreadsheet();
      if (pasteEl) pasteEl.focus();
    });
  }

  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("hover");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("hover"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("hover");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) accept(f);
  });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) accept(f);
    fileInput.value = "";
  });

  function accept(file) {
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      toast("That doesn't look like a PDF. Please pick a .pdf file.", "bad");
      return;
    }
    const prefix = $("prefix").value || "";
    // Auto-open the disclosure if the user has typed something but never
    // expanded it — defensive against a stray Tab-into-the-textarea workflow.
    if (detailsEl && pasteEl && pasteEl.value.trim() && !detailsEl.open) {
      detailsEl.open = true;
    }
    onFile({ file, prefix, checkLookup: currentLookup });
  }
}
