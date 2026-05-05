# Development Plan

## Architecture

Three layers, kept separate by import direction:

```
ui/  ←  main.js  →  pipeline/
```

- **`pipeline/`** — pure data work. Takes a `pdfDoc`, returns bundles / bytes. Reports progress through the two helpers in `ui/progress.js` (the only UI dependency). No event listeners, no DOM queries beyond the offscreen canvases it creates.
- **`ui/`** — DOM. Drop zone, progress bar, review grid, toast. Knows nothing about PDF.js, pdf-lib, Tesseract, or JSZip.
- **`main.js`** — the one place the two halves meet. UI events kick off the pipeline; pipeline errors get translated back into UI updates.
- **`state.js`** — a single mutable object passed into the pipeline and read by the review UI. No reactivity framework; just an object.

Why this split: the pipeline is the slow, library-heavy, easily-tested-in-isolation part. Keeping it DOM-free means we can later swap libraries (e.g. a different OCR engine), add unit tests, or run pieces in a worker without disturbing the UI.

## Build order

Each milestone is independently testable — finish and verify one before moving to the next so the slow stages (OCR especially) don't block debugging the upstream pieces.

### Milestone 0 — Scaffold ✅

- [x] Vite + vanilla JS project (`npm run dev`).
- [x] Three-screen shell: Upload, Progress, Review.
- [x] Visual style (warm off-white, serif headings, mono filenames, accent teal).
- [x] Drop zone with hover state; file input fallback; non-PDF rejection.
- [x] Settings input: prefix (default `LPTR-`). Red threshold is fixed at 55 in `state.js` — not user-editable.

### Milestone 1 — Read the PDF ✅

- [x] Load with PDF.js, store ArrayBuffer (for later pdf-lib use) + `PDFDocumentProxy`.
- [x] Stage indicator: "Reading PDF".

### Milestone 2 — Red page detection ✅

- [x] Render each page at 0.25× to an offscreen canvas.
- [x] Sample every 4th pixel; skip near-white / near-black; classify red-dominant.
- [x] Page is red when red-dominant share of considered pixels ≥ threshold.
- [x] Stage indicator: "Detecting red separator pages — page X of Y".
- [x] Yield to the event loop every 4 pages.

### Milestone 3 — Bundle splitting ✅

- [x] Walk page list; collapse runs of consecutive red pages into a single boundary.
- [x] Drop empty bundles silently.
- [x] Zero red pages → throw `PipelineError("no-red-pages")` so `main.js` shows a toast and returns to upload.

### Milestone 4 — Front-page rendering ✅

- [x] Render front page at 2× for the OCR canvas.
- [x] Render front page at 1.5× (or `devicePixelRatio` on HiDPI displays) and serialize as PNG for the review thumbnail. PNG keeps small text crisp; thumbnails are session-scoped so the size cost is acceptable.

### Milestone 5 — Text extraction ✅

- [x] Try `page.getTextContent()` first.
- [x] If under ~30 non-whitespace chars, fall back to Tesseract on the OCR canvas.
- [x] Reuse a single Tesseract worker across bundles; terminate when done.

### Milestone 6 — Address extraction ✅

- [x] Regex: number + optional directional + 1–4 word street name + street type.
- [x] Prefer matches that follow a "Property Address" / "Subject Property" / "Premises" / "Property Location" / "Site Address" label. This avoids picking up the title-company letterhead address at the top of front pages.
- [x] Fall back to first-match-wins when no label is present.
- [x] No match → blank, flagged in the UI.

### Milestone 7 — Filename construction ✅

- [x] Sanitize: whitespace → `-`, strip non-alnum/`-`, collapse `-`, trim.
- [x] Compose `${prefix}${sanitized}.pdf`.

### Milestone 8 — Review UI ✅

- [x] Grid of cards: index badge, page count, thumbnail, three-part filename row, status pill, skip/restore button.
- [x] Header: bundle/page summary, Start Over, Download All as ZIP.
- [x] Edits update the in-memory bundle immediately.

### Milestone 9 — Split & ZIP ✅

- [x] On Download click, use pdf-lib to copy the page indices for each non-skipped bundle.
- [x] Pack into JSZip with the user's edited filename.
- [x] Auto-suffix duplicates `-2`, `-3`, … silently.
- [x] Trigger blob download with a timestamped zip name.

### Milestone 10 — Edge cases (verify before declaring MVP done)

- [ ] PDF starts without a separator → first bundle correct.
- [ ] PDF ends without a separator → last bundle correct.
- [ ] Adjacent separator runs with nothing between → no empty bundle.
- [ ] Zero red pages → friendly toast, returned to upload screen.
- [ ] Bundle with no detectable address → blank field + warning indicator.
- [ ] Duplicate user-edited filenames → silent suffix on download.
- [ ] Non-PDF upload → rejected with a toast.
- [ ] Very large PDF → still works, progress bar stays responsive.

## Performance notes

- Red detection at 0.25× scale + pixel sampling is the hot path on long PDFs — keep it cheap.
- Tesseract is the slowest stage. Reuse one worker; prefer the embedded-text path whenever it has enough characters.
- Yield with `await yieldToUi()` (which is just `setTimeout(r, 0)`) every few pages / bundles so the UI doesn't freeze.

## Testing fixtures

- [tests/sample.pdf](tests/sample.pdf) — 22 pages, 6 packets (page counts 2/3/1/2/1/3), duplex red dividers between every packet, every front page has the title-company letterhead AND a labeled "Property Address" line. Each property address uses a different shape (no directional, single-letter directional, two-letter directional, full directional word, multi-word street names, abbreviated and spelled-out street types) to exercise the regex broadly. First and last packets have no leading/trailing divider — covers the start-without-separator and end-without-separator edge cases. Regenerate with `python tests/generate_sample_pdf.py`.
- TODO: a rasterized variant (no embedded text — forces the OCR path).

## After MVP (do not build yet)

Stop after Milestone 10 and let the user test against real packets. Likely follow-ups, deliberately deferred:

- More label vocabulary in `address.js` once we see what real packets actually print (e.g. "Subject Premises", "Property:", insurer-specific labels).
- QR code detection on dividers as a more reliable separator signal.
- Per-bundle preview beyond the first page.
- Batch-of-batches handling.
- Unit tests for `pipeline/` modules now that they're DOM-free (Vitest fits naturally with Vite).
