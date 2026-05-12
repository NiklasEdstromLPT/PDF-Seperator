# How It Works

A plain-language tour of what the PDF Separator does between "upload a batch" and "download a zip of named files." Written for stakeholders who want to understand the moving parts without reading the code.

---

## The Problem

Today, processing closing checks is a one-at-a-time job. For every single packet, a person has to:

1. Walk to the scanner and scan the packet by itself.
2. Read the check number off the front page.
3. Look the check number up in a live Excel sheet to find the matching property address.
4. Copy that address out of Excel and paste it into the filename.
5. Save the PDF using the `LPTR.<check#> - <address>.pdf` convention.

Thirty packets means thirty trips to the scanner, thirty Excel lookups, and thirty hand-typed filenames.

The tool collapses all of that into a single batch. The user stacks every packet together with a red divider page between each one, scans the whole stack in one pass, and drops the resulting PDF into the tool. The tool finds the dividers, splits the stack into individual packets, reads the check number and address straight off each front page, and produces a zip of correctly-named PDFs. A half-hour of clerical work becomes a minute of review.

Reading the address directly off the front page — rather than looking it up in Excel — means the Excel sheet stops being a bottleneck. The data is already on the check; the tool just picks it up.

---

## The Pipeline

The tool runs entirely in the user's browser — nothing is uploaded to a server. The PDF is opened, processed, and downloaded all locally. There are five stages:

```
Upload  →  Detect Dividers  →  Split into Packets  →  Read Each Front Page  →  Review & Download
```

### Stage 1 — Upload

The user drags a PDF onto the drop zone. The file is loaded into memory using PDF.js (Mozilla's PDF library). Non-PDF files are rejected immediately with a friendly message.

### Stage 2 — Detect the Red Divider Pages

This is the foundation of the whole tool. Every other stage depends on correctly identifying where one packet ends and the next begins.

**How it works:**

1. Each page of the PDF is rendered to a hidden image at **25% of its real size**. We don't need a crisp picture — we just need to know how red the page is. Shrinking makes the math 16× faster.
2. We then sample every 4th pixel of that small image (another 16× speedup) and look at its color.
3. We ignore near-white pixels (the paper) and near-black pixels (text and lines). What's left is the "colorful" content.
4. A pixel is classified as **red** if its red channel is meaningfully stronger than both green and blue — specifically, red > 100 *and* red exceeds green by 40 *and* red exceeds blue by 40. This catches printer reds, scanner reds, and slightly-faded reds without false-firing on warm grays or yellows.
5. If **55% or more** of the colorful pixels on a page are red-dominant, the page is flagged as a divider.

The 25% shrink + 4-pixel sampling means even a 500-page batch finishes detection in a few seconds.

### Stage 3 — Split into Packets

Once we know which pages are dividers, splitting is bookkeeping. The tool walks the page list and groups every run of non-divider pages into a "bundle." If two dividers sit next to each other with nothing between them, the empty bundle is dropped silently. If the PDF has no red pages at all, we surface a friendly error suggesting the user lower the red-detection threshold — usually a sign the dividers were scanned washed-out.

### Stage 4 — Read Each Front Page (OCR)

For every packet, the tool reads the front page to extract two things: the **check number** and the **property address**. These become the filename.

**Reading the text.** First, the tool tries to pull text directly out of the PDF using PDF.js — modern checks and closing forms usually have a real text layer embedded. If that comes back nearly empty (under 30 characters — meaning the page is a scanned image, not a digital document), it falls back to **Tesseract**, an open-source OCR engine running in the browser. Tesseract is slower, so we only use it when we have to.

#### Finding the Check Number

The check number is always printed in the top-right corner of a check. Below it sits the date, then the dollar amount, and at the bottom is the MICR line (the long account/routing string). All those numbers can look alike to a regex, so we use **position** to pick the right one.

1. **First try the banner.** Many LPT batches print a closing-summary banner that reads `**** REAL ESTATE CLOSING **** 462057`. If that pattern matches, we return the number immediately — it's the highest-confidence source.
2. **Otherwise, rank by position.** We collect every 3- to 12-digit run on the page that isn't preceded by a `$`, a decimal point, or a hyphen, and isn't followed by another digit or slash. From those candidates we pick the **rightmost** one (ties broken by topmost). On a real check, that's always the check number.
3. **If nothing qualifies, leave the field blank.** A missing badge is better than a wrong one — the user will fill it in during review.

#### Finding the Property Address

Addresses are harder because the front page is full of names, dollar amounts, and other addresses (the title company's letterhead, the LPT payee block, etc.). The tool uses a **labeled-window** strategy rather than guessing.

1. **Find a label.** We search the page for known labels: `Property Address:`, `Property:`, `Subject Property:`, `Property Location:`, `Site Address:`, `Premises:`, `For:`, `Memo:`, and a few others. The labels are required to end in a colon.
2. **Scan a small window after the label.** We look at the next ~220 characters and try two regex patterns:
   - A **strict** pattern that requires a known USPS street suffix (Street, Avenue, Rd, Blvd, Dr, Ln, Ct, Pl, Way, Pkwy, Hwy, Cir, Ter, Trl, Loop, Plaza, Sq, Run, Crossing, Park, Path, Walk, Pass, Glen, Heights, Manor, Bend, Ridge, Cove, Row). A match here is high-confidence — the address gets a green "Address Detected" pill.
   - A **loose** pattern that accepts any capitalized 3+ letter word as the suffix. This catches uncommon street names like "Sunrise" or "Meadow Trace." A match here gets a yellow "Verify — Unfamiliar Suffix" pill so the user double-checks before approving.
3. **Two-pass fallback.** Strict is tried on every label first. Only if no strict address is found anywhere on the page do we let loose matches win — otherwise loose would steal from real-but-uncommon prose.
4. **Reject known false positives.** LPT's own payee block (1400 South International Parkway, Lake Mary FL) is hardcoded as a blacklist so we never name a customer's packet after LPT.
5. **Trim the trap.** A common OCR slip is "123 Pear Drive St. Louis" — the regex grabs the city. If an address ends in `St`, `Mt`, or `Ft` *and* the word before is a real street suffix like "Drive," we drop the trailing word. This recovered hundreds of addresses in real testing.
6. **No match?** The card gets a red "Address Required" banner. Nothing is named wrong — it's flagged for the user to type in.

### Stage 5 — Review & Download

Every bundle becomes a card in a grid. Cards are sorted so the ones needing attention rise to the top:

| Priority | Status | What the user sees |
|---|---|---|
| 1 | No address found | Red border, "ADDRESS REQUIRED" |
| 2 | Unfamiliar street suffix | Amber border, "NEEDS REVIEW" |
| 3 | Auto-detected, awaiting approval | Yellow pill, "PENDING APPROVAL" |
| 4 | Skipped or approved | Quiet, settled |

Each card shows:

- **A thumbnail of the front page**, clickable to open a full-screen zoom.
- **A yellow highlighter overlay** drawn on top of the thumbnail showing exactly where on the page we found the check number and the address. This is the user's at-a-glance confirmation that the OCR landed on the right text. The highlights are translucent yellow (#FCD34D at 55% opacity, "multiply" blend mode) so they look like a real marker stripe. Crucially, the highlights live only in the review UI — they're never burned into the final exported PDF.
- **An editable filename** split into three parts: a locked prefix (`LPTR.`), an editable middle (check# + address), and a locked extension (`.pdf`). The user can correct anything inline.
- **Skip** and **Approve** buttons. Every non-skipped bundle requires an explicit approval click before download. This is the gate that ensures a human signed off on every filename.

When the user clicks **Download All as ZIP**, the tool uses pdf-lib to copy the pages of each approved bundle into its own PDF, packs them into a zip, deduplicates any clashing filenames with `(2)`, `(3)`, etc., and triggers a browser download named like `dezzy-split-2026-05-12T14-32.zip`.

---

## Filename Normalization

The output convention is `LPTR.<Check#> - <Address>.pdf`. To make filenames clean and consistent, the tool quietly:

- Strips leading zeros from the check number (`00098765` → `98765`).
- Abbreviates street suffixes to USPS standard (`Street` → `St`, `Avenue` → `Ave`, `Boulevard` → `Blvd`, etc.).
- Removes any characters Windows refuses in filenames (`< > : " / \ | ? *` and control chars).
- Collapses runs of spaces.
- If two packets resolve to the same name, the second gets ` (2)` appended automatically.

All of this naming logic lives in one file (`src/pipeline/filename.js`) so changing the convention — for example, going from `LPTR.123 - 456 Oak St.pdf` to `LPTR_123_456-Oak-St.pdf` — is a single-file edit.

---

## What Could Change in the Future

The tool is built so each of these knobs is a single-line edit in a clearly-named file. Nothing in the list below requires a rewrite.

### Visual & UI

- **Divider page color.** Today we look for red. The detector is just a color-channel rule; swapping to blue, green, or magenta dividers is changing three numbers in `redDetect.js`. Useful if a workflow elsewhere already uses a different divider color.
- **Highlighter color.** The translucent yellow stripe on review thumbnails is one CSS line. Could be changed to pink, green, or even per-field (e.g., blue for check#, yellow for address) so reviewers can tell at a glance which highlight belongs to which field.
- **Review grid density.** Today the grid shows at most 2 cards per row, sized so a card fits in one viewport. We could show 3 or 4 smaller cards per row for power users who'd rather scan-and-approve quickly than zoom on each thumbnail. The breakpoint and card-size formula are in `styles.css`.
- **Pages displayed per packet.** Right now reviewers see only the front page of each packet. We could show the first 2–3 pages — useful for batches where the address sometimes prints on page 2, or where the reviewer wants to double-check that the right pages are bundled. This is the most-requested enhancement and is a contained change in the review UI.
- **Lightbox enhancements.** The zoom view could grow pan controls, multi-page navigation within a packet, or side-by-side comparison with a previously-saved file.

### Detection & OCR

- **Red threshold.** Today 55% of the colorful pixels must be red. Faded or photocopied dividers might need this lowered to 35–40%; very strict batches could raise it to 70%. It's already user-adjustable on the upload screen.
- **Sampling density.** We sample every 4th pixel. Tiny dividers (a red strip rather than a full red page) might need every pixel — slower, but achievable.
- **More address labels.** The label list (`Property Address:`, `Premises:`, etc.) grows whenever we see a new packet format. Adding a label is one line in `address.js`.
- **Smarter check# detection.** Today we rank by screen position. For unusual layouts — for example, a check that prints the number on the left — we could add a small machine-learning classifier trained on a few hundred LPT checks. Overkill for the current accuracy but plausible later.
- **OCR engine swap.** Tesseract is open-source and runs in the browser. If accuracy on scanned packets becomes a bottleneck, we could swap to a cloud OCR service (AWS Textract, Google Document AI) at the cost of needing a server and an API budget. The pipeline is deliberately modular so this is a one-file substitution.

### Workflow

- **Per-bundle preview beyond page 1.** See above under "Pages displayed per packet."
- **Batch-of-batches.** Today the tool processes one master PDF at a time. We could allow multiple PDFs to be queued and processed sequentially.
- **Save state across sessions.** Right now reviewing a batch is one continuous session — closing the browser tab loses the work. Local-storage persistence would let a reviewer pause and resume.
- **Audit log.** Export a CSV alongside the ZIP recording which bundles were auto-detected vs. user-corrected, which were skipped, and what the original OCR guesses were. Useful for compliance and for measuring where the tool gets things wrong.
- **Direct upload to network share.** Today the user downloads a ZIP and unpacks it onto a shared drive. We could wire the tool to drop the files straight into a SharePoint/OneDrive folder, eliminating the manual unzip.

---

## Why This Architecture

A few decisions worth understanding:

- **Browser-only.** No file ever leaves the user's machine. There is no server, no API key, no cloud cost, and no compliance surface beyond the user's laptop. The trade-off is that very large batches (1000+ pages) work but slower than a server would manage.
- **Three-layer split.** The PDF logic (`pipeline/`) doesn't know the UI exists; the UI (`ui/`) doesn't know PDF.js or Tesseract exist. They meet in one file (`main.js`). This means tomorrow we can swap the OCR engine, add unit tests, or rebuild the UI without disturbing the other half.
- **Human-in-the-loop by design.** Every non-skipped bundle requires an explicit approval click. The tool is fast at the boring parts (splitting, OCR, naming) but never auto-files anything the user hasn't seen. The cost of a wrong filename in the wild is far higher than the few seconds a reviewer spends clicking Approve.
