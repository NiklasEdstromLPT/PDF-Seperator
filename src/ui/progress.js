import { $ } from "./dom.js";

const STAGE_ORDER = ["read", "detect", "split", "ocr"];

export function setStage(name) {
  const target = STAGE_ORDER.indexOf(name);
  for (const el of document.querySelectorAll(".stage")) {
    const i = STAGE_ORDER.indexOf(el.dataset.stage);
    el.classList.toggle("active", i === target);
    el.classList.toggle("done", i < target);
  }
}

export function setProgress(percent, detail) {
  const fill = $("bar-fill");
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (detail !== undefined) {
    const d = $("progress-detail");
    if (d) d.textContent = detail;
  }
}
