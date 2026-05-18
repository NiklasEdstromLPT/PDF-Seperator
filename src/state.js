// Shared mutable state. Module-scoped object — no localStorage, no persistence.
export const state = {
  file: null,
  pdfBytes: null,   // ArrayBuffer of the source PDF
  pdfDoc: null,     // pdf.js PDFDocumentProxy
  bundles: [],      // [{ index, pages, thumbnail, address, addressDetected, skipped }]
  prefix: "LPTR.",
  threshold: 55,
  // Optional check#→address table from a pasted-in Excel range.
  // Built by buildCheckLookup() in pipeline/checkLookup.js; null when the
  // user didn't paste anything.
  checkLookup: null,
};

export function resetState() {
  state.file = null;
  state.pdfBytes = null;
  state.pdfDoc = null;
  state.bundles = [];
  state.checkLookup = null;
}
