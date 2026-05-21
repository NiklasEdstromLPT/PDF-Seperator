// Tiny DOM helpers — screens (one visible at a time), toast, and a $ shortcut.

export const $ = (id) => document.getElementById(id);

const SCREEN_IDS = ["upload", "progress", "review", "how-it-works"];

export function showScreen(name) {
  for (const k of SCREEN_IDS) {
    const el = $(`screen-${k}`);
    if (el) el.classList.toggle("active", k === name);
  }
}

let toastTimer = null;

export function toast(msg, kind = "") {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.toggle("bad", kind === "bad");
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 4000);
}

// Yield to the event loop so the UI can repaint mid-pipeline.
export const yieldToUi = () => new Promise((r) => setTimeout(r, 0));
