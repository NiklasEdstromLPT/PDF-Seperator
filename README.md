# Dezzy Check Splitter

Internal browser-based tool for AR (Accounts Receivable) staff. Takes a single batched PDF scan containing multiple transaction packets separated by red divider pages, automatically splits it into individual packet PDFs, extracts the property address from each packet's front page via OCR, and presents a review UI for the user to verify and correct names before downloading the result as a zip.

## What it does

1. User drops in a batched PDF scan (multiple packets, each separated by a red divider page).
2. Tool detects red separator pages, splits the source PDF into one PDF per packet.
3. For each packet, it reads the front page (embedded text first, OCR fallback) and pulls a US street address out of the text.
4. User reviews a grid of packet thumbnails with proposed filenames, edits anything wrong, optionally skips bundles.
5. User clicks **Download All** and gets a ZIP of named PDFs.

## Hard constraints

- **100% client-side.** No backend, no API calls, no external services. Client financial data — nothing leaves the user's machine.
- **Free libraries only.** No paid APIs.
- **No persistent storage.** No localStorage, sessionStorage, IndexedDB, or cookies. Every session starts clean.

## Tech stack

- **Vite** — dev server, HMR, static build output
- [PDF.js](https://mozilla.github.io/pdf.js/) — render PDF pages to canvas, extract embedded text layer
- [pdf-lib](https://pdf-lib.js.org/) — split source PDF into per-bundle output PDFs
- [Tesseract.js](https://tesseract.projectnaptha.com/) — OCR fallback when no embedded text exists
- [JSZip](https://stuk.github.io/jszip/) — bundle output PDFs into one zip download

## Project layout

```
dezzy-check-splitter/
├── index.html              entry shell
├── package.json
├── vite.config.js
├── src/
│   ├── main.js             entry: wires UI events to the pipeline
│   ├── state.js            shared in-memory state (no persistence)
│   ├── styles.css
│   ├── pipeline/
│   │   ├── index.js        runPipeline() orchestrator + PipelineError
│   │   ├── redDetect.js    canvas sampling for red separator pages
│   │   ├── bundles.js      splits the page list on separator runs
│   │   ├── frontPage.js    thumbnail render, text extract, OCR fallback
│   │   ├── address.js      US street-address regex
│   │   ├── filename.js     sanitize + dedupe
│   │   └── zip.js          pdf-lib copyPages + JSZip pack + download trigger
│   └── ui/
│       ├── dom.js          $/screens/toast/yield helpers
│       ├── upload.js       drop zone + file picker + settings
│       ├── progress.js     stage indicator + bar
│       └── review.js       review grid + cards
└── tests/
    ├── generate_sample_pdf.py
    └── sample.pdf
```

The pipeline modules know nothing about the DOM beyond the progress helpers. The UI modules know nothing about PDF.js / pdf-lib / Tesseract. `main.js` is the only place they meet.

## Running it

```bash
npm install
npm run dev      # Vite dev server with HMR at http://localhost:5173
```

Production build (static files, deployable to any directory):

```bash
npm run build    # outputs to dist/
npm run preview  # serve the built output locally to verify
```

## Settings

- **Filename prefix** — defaults to `LPTR-`. Editable per session.

The red-detection threshold is fixed at 55 in code. If real-world scans require tuning, change `state.threshold` in [src/state.js](src/state.js) — not exposed to users.

## Output naming

Per LPT AR procedure: `LPTR <Check Number> <Property Address>`, hyphenated for filesystem-friendliness. Example: `LPTR-462057-54023-Driftwood-Avenue.pdf`. Duplicate filenames are silently suffixed `-2`, `-3`, etc.

If a check arrives without a detectable property address (e.g. random-company checks per AR's exception process), the address piece comes through blank — AR enters the property manually in the review screen, or skips the bundle for further research.

## Out of scope (intentionally)

- SharePoint / cloud upload
- Folder watching or auto-pickup
- Session logs written to disk
- QR code detection on dividers (later phase)
- Connect platform integration
- Multi-document or batch-of-batches handling
- Auth, user accounts, persistence

## Testing

The PDF generator under `tests/` is local-only and not committed (see [.gitignore](.gitignore)). It produces a synthetic batched PDF that mirrors a real LPT closing batch — useful for exercising red-page detection, multi-address fronts, and the various property-address label shapes without using customer data. If you need a fixture, ask the original author for a copy of the generator script or build your own.

See [DEVELOPMENT.md](DEVELOPMENT.md) for the build plan and step-by-step pipeline notes.
