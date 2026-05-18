// Spreadsheet-paste lookup table.
//
// AR staff copy a range out of Excel (LPT Realty Deposit sheet) and paste it
// at the start of a session. We parse the tab-separated clipboard into rows
// keyed by check number, and during OCR each bundle's auto-extracted check#
// gets a chance to override the OCR-extracted address with the row from the
// spreadsheet.
//
// Match tiers:
//   exact — check# matches a row after stripping leading zeros and non-digits.
//           Returned address replaces the OCR address; confidence stays "strong"
//           but addressSource = "spreadsheet" so the review pill can label it.
//   fuzzy — same normalization, edit distance ≤ 1 against any row's check#
//           (and both sides are ≥ 4 digits to keep noise down). Address still
//           auto-fills, but confidence drops to "weak" so the bundle lands in
//           the amber "verify" tier on the review screen.
//   none  — leave the OCR result alone.
//
// Parsing is best-effort: we accept the most common Excel-paste shapes —
// optional header row, any column order, a few label aliases — and bail to
// `{ rows: [], warnings: [...] }` when the paste doesn't look usable.

import { stripLeadingZeros } from "./filename.js";

// Header-row keywords. The header detector matches case-insensitively against
// the entire cell, allowing for trailing punctuation or whitespace.
const CHECK_HEADER_RE = /^\s*(check\s*#?|check\s*(no\.?|number)|chk\s*#?)\s*$/i;
const ADDRESS_HEADER_RE = /^\s*(property\s*address|address|property)\s*$/i;

// A "check-number-shaped" cell: 3-12 digits, or the NN-NNNNNNNNNN dash
// format used by some bank-issued business checks (matches checkNumber.js).
const CHECK_SHAPE_RE = /^\s*(\d{2}-\d{10}|\d{3,12})\s*$/;

// An "address-shaped" cell: starts with a number, contains at least one
// alphabetic token afterward. Loose by design — addresses without a leading
// number (e.g. "Lake Lowery Road") are accepted via fallback if the
// check-column heuristic locks in.
const ADDRESS_SHAPE_RE = /^\s*\d+\s+\S/;

// Parse a clipboard string (tab-separated, newline-delimited) into a list of
// `{ checkNumber, address }` rows. Returns `{ rows, warnings, columns }`.
// `columns` is `{ check, address }` (zero-based indices into the parsed grid),
// useful for the UI to surface what we picked.
export function parsePastedRows(raw) {
  if (!raw || typeof raw !== "string") {
    return { rows: [], warnings: ["No data pasted."], columns: null };
  }

  // Normalize line endings; trim trailing blanks but preserve interior empties
  // (an empty row inside the paste isn't fatal — we just skip it).
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const grid = lines
    .map((ln) => ln.split("\t"))
    .filter((row) => row.some((c) => c && c.trim() !== ""));

  if (grid.length === 0) {
    return { rows: [], warnings: ["No data pasted."], columns: null };
  }

  const warnings = [];
  const cols = detectColumns(grid);
  if (!cols) {
    return {
      rows: [],
      warnings: [
        "Couldn't find a Check # column and a Property Address column in the pasted data. Include the header row, or paste only the two relevant columns.",
      ],
      columns: null,
    };
  }

  // Skip the header row if we detected one.
  const start = cols.headerRow + 1;
  const rows = [];
  const seen = new Set();
  for (let i = start; i < grid.length; i++) {
    const row = grid[i];
    const rawCheck = (row[cols.check] || "").trim();
    const rawAddress = (row[cols.address] || "").trim();
    if (!rawCheck && !rawAddress) continue;
    if (!rawCheck || !rawAddress) {
      // Half-filled rows are noise — Excel sometimes copies the totals row.
      continue;
    }
    const norm = normalizeCheck(rawCheck);
    if (!norm) continue;
    if (seen.has(norm)) {
      warnings.push(`Duplicate check # ${rawCheck} in pasted data — keeping the first.`);
      continue;
    }
    seen.add(norm);
    rows.push({ checkNumber: rawCheck, address: rawAddress, normalized: norm });
  }

  if (rows.length === 0) {
    warnings.push("No data rows found beneath the header.");
  }

  return { rows, warnings, columns: { check: cols.check, address: cols.address } };
}

// Reconcile the OCR-extracted address with an optional spreadsheet lookup.
// Returns `{ address, confidence, source, match }`:
//   - exact match  → spreadsheet address, strong, source "spreadsheet"
//   - fuzzy match  → spreadsheet address, weak,   source "spreadsheet-fuzzy"
//   - no lookup or no match → OCR address + OCR confidence, source "ocr"
//
// We intentionally trust the spreadsheet over the OCR address when both
// exist: the spreadsheet is the source of truth the AR team maintains, and
// OCR addresses are well-known to mis-grab the title-company letterhead or
// memo line. The approval gate downstream still forces a human to ack every
// bundle before it ships.
export function applyCheckLookup({ checkNumber, ocrAddress, lookup }) {
  const fallback = {
    address: ocrAddress.value,
    confidence: ocrAddress.confidence,
    source: "ocr",
    match: null,
  };
  if (!lookup || !checkNumber) return fallback;
  const hit = lookup.find(checkNumber);
  if (!hit) return fallback;
  return {
    address: hit.address,
    // Fuzzy matches drop to weak so they land in the amber "verify" tier.
    // Exact matches stay strong — the approval gate still requires a click.
    confidence: hit.kind === "exact" ? "strong" : "weak",
    source: hit.kind === "exact" ? "spreadsheet" : "spreadsheet-fuzzy",
    match: hit,
  };
}

// Build a lookup object with .find(checkNumber) → { address, source } | null.
// Returns null if `rows` is empty (so callers can `if (!lookup)` to skip).
export function buildCheckLookup(rows) {
  if (!rows || rows.length === 0) return null;

  const byNormalized = new Map();
  for (const r of rows) {
    byNormalized.set(r.normalized, r);
  }
  // Pre-stash an array for the fuzzy fallback so we don't re-iterate the Map
  // every lookup. Small (< few hundred entries) so this is fine.
  const rowList = [...byNormalized.values()];

  return {
    size: rowList.length,
    rows: rowList,
    /**
     * Look up an OCR'd check number against the pasted rows.
     * Returns `{ address, matchedCheck, kind: "exact"|"fuzzy", distance }` or null.
     */
    find(checkNumber) {
      const target = normalizeCheck(checkNumber);
      if (!target || target.length < 3) return null;

      const exact = byNormalized.get(target);
      if (exact) {
        return {
          address: exact.address,
          matchedCheck: exact.checkNumber,
          kind: "exact",
          distance: 0,
        };
      }

      // Fuzzy: edit distance ≤ 1 against any row. Skip very short keys to
      // avoid false positives ("123" matches "124" matches "120"...).
      if (target.length < 4) return null;
      let best = null;
      for (const r of rowList) {
        if (r.normalized.length < 4) continue;
        if (Math.abs(r.normalized.length - target.length) > 1) continue;
        const d = editDistance1(target, r.normalized);
        if (d <= 1 && (best === null || d < best.distance)) {
          best = {
            address: r.address,
            matchedCheck: r.checkNumber,
            kind: "fuzzy",
            distance: d,
          };
          if (d === 0) break;
        }
      }
      return best;
    },
  };
}

// Normalize a check number for lookup keys: strip non-digit/dash chars,
// then strip leading zeros from a pure-digit string. Keeps the
// "NN-NNNNNNNNNN" dash format intact since stripLeadingZeros() short-circuits
// on non-pure-digit input.
export function normalizeCheck(value) {
  if (!value) return "";
  const cleaned = String(value).trim().replace(/[^\d\-]/g, "");
  if (!cleaned) return "";
  return stripLeadingZeros(cleaned);
}

// Edit distance bounded at 1 — returns the actual distance if it's 0 or 1,
// otherwise returns 2 (i.e. ">1"). Faster than full Levenshtein because we
// can bail as soon as we see a second mismatch. Inputs are short digit
// strings so allocating a full DP table would be wasteful.
function editDistance1(a, b) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return 2;

  if (la === lb) {
    // Single substitution allowed.
    let diff = 0;
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i]) {
        diff++;
        if (diff > 1) return 2;
      }
    }
    return diff;
  }

  // Lengths differ by exactly 1 — check if the shorter is the longer minus
  // one character (single insertion/deletion).
  const [shorter, longer] = la < lb ? [a, b] : [b, a];
  let i = 0, j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
    } else if (!skipped) {
      skipped = true;
      j++;
    } else {
      return 2;
    }
  }
  return 1;
}

// Decide which columns of the parsed grid hold the check# and the address.
// Returns `{ check, address, headerRow }` (headerRow is -1 if there was no
// header — we treat row 0 as data) or null if neither path lands.
function detectColumns(grid) {
  const headerHit = detectByHeader(grid);
  if (headerHit) return headerHit;

  // No header: heuristic on the first ~10 data rows. Pick the column whose
  // cells most often look like check numbers; pick a different column whose
  // cells most often look like addresses.
  //
  // Tie-break for the check column on average digit length — a real Check #
  // column tends to be 7+ digits, while Trans ID / sequence columns sit at
  // 5-6. Without this, a sheet with both columns numeric would always pick
  // the leftmost (i.e. Trans ID), since pickBest is left-biased.
  const ncols = Math.max(...grid.map((r) => r.length));
  const sample = grid.slice(0, Math.min(grid.length, 10));

  const checkScores = new Array(ncols).fill(0);
  const checkLengths = new Array(ncols).fill(0);
  const checkCounts = new Array(ncols).fill(0);
  const addrScores = new Array(ncols).fill(0);
  for (const row of sample) {
    for (let c = 0; c < ncols; c++) {
      const cell = (row[c] || "").trim();
      if (CHECK_SHAPE_RE.test(cell)) {
        checkScores[c]++;
        checkLengths[c] += cell.replace(/\D/g, "").length;
        checkCounts[c]++;
      }
      if (ADDRESS_SHAPE_RE.test(cell)) addrScores[c]++;
    }
  }
  const avgLengths = checkLengths.map((l, i) =>
    checkCounts[i] ? l / checkCounts[i] : 0
  );
  const checkCol = pickBestCheck(checkScores, avgLengths);
  if (checkCol === -1) return null;
  // Don't let the same column win both roles.
  addrScores[checkCol] = -1;
  const addrCol = pickBest(addrScores);
  if (addrCol === -1) return null;
  return { check: checkCol, address: addrCol, headerRow: -1 };
}

function detectByHeader(grid) {
  // Search the first up to 3 rows for one that contains both a Check# header
  // and a Property Address header (Excel ranges sometimes include a title
  // row above the actual column headers).
  for (let r = 0; r < Math.min(grid.length, 3); r++) {
    const row = grid[r];
    let checkCol = -1;
    let addrCol = -1;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c] || "";
      if (checkCol === -1 && CHECK_HEADER_RE.test(cell)) checkCol = c;
      else if (addrCol === -1 && ADDRESS_HEADER_RE.test(cell)) addrCol = c;
    }
    if (checkCol !== -1 && addrCol !== -1) {
      return { check: checkCol, address: addrCol, headerRow: r };
    }
  }
  return null;
}

function pickBest(scores) {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > bestScore) {
      bestScore = scores[i];
      best = i;
    }
  }
  return best;
}

// Like pickBest, but breaks ties on the score (which we need within ~1 since
// a column with one mis-shaped row would otherwise outrank a strictly-longer
// column). Then prefers the column with the longer average digit length, so
// Check # (7-8 digits) beats Trans ID (5-6 digits) when both columns pass the
// shape filter on every row.
function pickBestCheck(scores, avgLengths) {
  let best = -1;
  let bestScore = 0;
  let bestLen = 0;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] === 0) continue;
    // "Within 1 of the leader" still counts as a tie. Single outlier rows
    // (e.g. a totals row) shouldn't flip the column choice.
    const leadByScore = scores[i] - bestScore;
    if (leadByScore >= 1) {
      best = i;
      bestScore = scores[i];
      bestLen = avgLengths[i];
    } else if (leadByScore >= -1 && avgLengths[i] > bestLen) {
      best = i;
      bestScore = Math.max(bestScore, scores[i]);
      bestLen = avgLengths[i];
    }
  }
  return best;
}
