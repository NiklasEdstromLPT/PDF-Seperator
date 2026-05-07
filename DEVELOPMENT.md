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

### Milestone 6 — Address & check-number extraction ✅

#### Address: three-tier extraction

- [x] **Strict regex** (the existing one) requires a known suffix: `St, Street, Ave, Avenue, Rd, Road, Blvd, Boulevard, Dr, Drive, Ln, Lane, Ct, Court, Pl, Place, Way, Pkwy, Parkway, Hwy, Highway, Cir, Circle, Ter, Terrace, Trl, Trail, Loop, Plaza, Sq, Square, Run, Crossing, Park, Path, Walk, Pass, Glen, Heights, Manor, Bend, Ridge, Cove, Row`. Match → `{ confidence: "strong" }`. Covers ~95–97% of US addresses.
- [x] **Loose regex** matches the same structural shape but accepts any capitalized word (≥3 chars) as the suffix slot. Catches `Sunrise`, `Meadow`, `Trace`, etc. without growing the strict list endlessly. Match → `{ confidence: "weak" }`.
- [x] Loose stop-list rejects unit/floor words that look like suffixes by capitalization: `Apartment, Apt, Suite, Ste, Unit, Floor, Fl, Building, Bldg`. Stops "1234 Main Apartment" from soft-matching when the real suffix is missing.
- [x] Walk every label hit (`Property Address:`, `Property:`, `For:`, `Subject Property:`, `Property Location:`, `Site Address:`, `Premises:`) in document order. Each label requires a colon. Try strict on every label first; only fall back to the best weak candidate if no strict match anywhere.
- [x] For each label, scan only the next ~220 chars for an address pattern. The bounded window stops a corrupted label line from reaching across the page and pulling in some unrelated address.
- [x] Reject any match (strict or loose) that's the LPT payee block (`1400 South International Parkway`, `Lake Mary, FL 32746`).
- [x] **No first-match-wins fallback on the whole page.** If no labeled match in any window is valid, return `{ confidence: "none" }`. In real packets the first match is almost always the title-company letterhead at the top of the check, which is wrong.
- [x] On the bundle, `addressDetected` is true ONLY for strong matches — weak and none both flag for human review through the existing `needsReview()` gate. `addressConfidence` carries the tier for visual differentiation only.

#### Check number: position-ranked extraction

- [x] **Tier 1 (banner regex):** `**** REAL ESTATE CLOSING **** <number>` on the full-page text. Reliable when present; returns immediately.
- [x] **Tier 2 (position-ranked candidates):** collect every 4–12 digit run on the page that passes a strict negative-lookaround filter (no leading `$`/`-`/`/`/digit, no trailing digit/`-`/`/`). Range covers ordinary checks (4–7), long corporate / cashier serials (8–10), and money-order serials (11–12). Sort by `(-x, -y)` — rightmost first, topmost as tiebreaker — and return the winner. On real checks the check# is the absolute top-right element; date prints below, dollar amount below the date, account/routing numbers in the MICR line at the bottom. Position-ranking picks the check# without a hardcoded crop region.
- [x] Candidates come from `page.getTextContent().items` on the embedded-text path (positions read from `transform[4]/transform[5]`) or from `Tesseract.data.words` on the OCR fallback path (positions read from `bbox`, with y negated to match PDF.js's bottom-up convention so the same sort works for both).
- [x] **Tier 3:** return `""` when no candidates pass the filter. Better to show no badge than a wrong one.
- [x] Displayed as a badge on each review card next to the bundle index and page count.

### Milestone 6.5 — Visual flagging when extraction is uncertain ✅

- [x] Cards flow through `needsReview(b)` = `!skipped && !addressDetected && !reviewConfirmed`. Both weak and none tiers count as flagged because `addressDetected` is true only for strong.
- [x] **Weak tier** (`addressConfidence === "weak"`): `.card.needs-review` class — amber/orange 2px border, "NEEDS REVIEW" tag, status pill reads "verify — unfamiliar suffix". User can ✓ Approve to clear if the loose match was right.
- [x] **None tier** (`addressConfidence === "none"`): `.card.needs-review.no-match` adds a red 3px border, "ADDRESS REQUIRED" tag, status pill reads "needs review — enter address". Same Approve flow.
- [x] **Strong tier**: no extra class, default green-dot pill ("address detected").
- [x] Skipped cards suppress the tag in either tier.
- [x] Top-of-screen counter (`X bundles need review`) + download-time confirm dialog (existing infrastructure) cover both flagged tiers automatically.

### Milestone 7 — Filename construction ✅

- [x] Sanitize: whitespace → `-`, strip non-alnum/`-`, collapse `-`, trim.
- [x] Naming convention per AR procedure: `LPTR <Check Number> <Property Address>`, hyphenated. Example: `LPTR-462057-54023-Driftwood-Avenue.pdf`. The check number and address are joined into a single editable name body on each review card so users can correct either piece in one input.
- [x] All joining logic centralized in [src/pipeline/filename.js](src/pipeline/filename.js) (`sanitize`, `buildNameBody`, `composeFilename`, `uniqueName`) so swapping hyphens for spaces — or adopting any other convention — is a single-module edit.
- [x] Empty pieces drop cleanly: missing address → `LPTR-462057.pdf`; missing check# → `LPTR-54023-Driftwood-Avenue.pdf`; both empty → `bundle-XX.pdf` fallback.

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

The `tests/` directory and the `sample_check_generator/` directory are both gitignored (see [.gitignore](.gitignore)). Test fixtures are kept local-only — they're not part of the shipped tool and don't need to live in version control. Build your own batched PDF with red separator pages or use a real (redacted) batch when smoke-testing the pipeline.

The synthetic generator that previously lived at `tests/generate_sample_pdf.py` produced 8 packets / 34 pages modeled on a real LPT closing batch — title-company letterhead, check-number banner, LPT payee block (which the regex must NOT pick up), and property address printed under one of `For:`, `Property:`, or `Property Address:` (rotated per packet so every label shape gets exercised). Useful pattern to recreate if you want repeatable test data.

Things still worth covering whenever you build a fixture:
- a rasterized variant (no embedded text — forces the OCR path)
- a packet with corrupted / scrambled OCR text on one front page (exercises the "no labeled address → flag for review" path)

## After MVP (do not build yet)

Stop after Milestone 10 and let the user test against real packets. Likely follow-ups, deliberately deferred:

- More label vocabulary in `address.js` once we see what real packets actually print (e.g. "Subject Premises", "Property:", insurer-specific labels).
- QR code detection on dividers as a more reliable separator signal.
- Per-bundle preview beyond the first page.
- Batch-of-batches handling.
- Unit tests for `pipeline/` modules now that they're DOM-free (Vitest fits naturally with Vite).
