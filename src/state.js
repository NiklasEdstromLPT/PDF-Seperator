// Shared mutable state. Module-scoped object — no localStorage, no persistence.
export const state = {
  file: null,
  pdfBytes: null,   // ArrayBuffer of the source PDF
  pdfDoc: null,     // pdf.js PDFDocumentProxy
  bundles: [],      // [{ index, pages, thumbnail, address, addressDetected, skipped }]
  prefix: "LPTR.",
  threshold: 55,
};

export function resetState() {
  state.file = null;
  state.pdfBytes = null;
  state.pdfDoc = null;
  state.bundles = [];
}
