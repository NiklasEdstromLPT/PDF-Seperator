import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { composeFilename, uniqueName } from "./filename.js";

// Build a ZIP blob containing one PDF per non-skipped bundle.
// Each output PDF is built by copying the bundle's pages from the source.
// Duplicate filenames are silently auto-suffixed.
export async function buildZip(srcBytes, liveBundles, prefix) {
  const srcDoc = await PDFDocument.load(srcBytes);
  const zip = new JSZip();
  const used = new Set();

  for (const b of liveBundles) {
    const out = await PDFDocument.create();
    const copied = await out.copyPages(srcDoc, b.pages);
    for (const p of copied) out.addPage(p);
    const bytes = await out.save();

    const body = b.nameBody || `bundle-${String(b.index + 1).padStart(2, "0")}`;
    const name = uniqueName(used, composeFilename(prefix, body));
    zip.file(name, bytes);
  }

  return await zip.generateAsync({ type: "blob" });
}

export function suggestZipName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  return `dezzy-split-${stamp}.zip`;
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}
