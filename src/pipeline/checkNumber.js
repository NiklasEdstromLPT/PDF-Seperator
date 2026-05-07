// Check number extraction.
//
// Tier 1: banner regex on the full page text. Real LPT closing packets carry
//   "**** REAL ESTATE CLOSING **** <number>" in the closing summary; when
//   present that's the most reliable signal there is.
//
// Tier 2: position-ranked candidate selection. The check# always prints as the
//   absolute top-right element on a check — date sits below it, dollar amount
//   below the date, account/routing numbers far below in the MICR line. Sort
//   candidate digit runs by (-x, -y) (rightmost first, topmost as tiebreaker)
//   and the check# wins. Independent of page size and check position.
//
// Tier 3: return "" when no candidates at all.
//
// The tier-2 candidates are built upstream in frontPage.js with positional
// metadata from PDF.js (getTextContent items) or Tesseract (data.words).

// Range covers ordinary checks (4-7 digits), long corporate / cashier check
// serials (8-10), and money-order serials (11-12 — USPS / Western Union money
// orders use 11-digit serial numbers). 12 is the upper bound: anything longer
// is almost certainly an account or routing number, not a check / MO serial.
const BANNER_RE = /\*+\s*REAL\s*ESTATE\s*CLOSING\s*\*+\s*(\d{3,12})\b/i;

// Strict digit filter: 4-12 digit run, NOT preceded by $, ., -, /, or another
// digit, and NOT followed by another digit, -, or /. Filters out dollar
// amounts, dates, escrow fragments, and adjacent-digit fragments of longer
// numbers. The negative-digit lookarounds matter most for the upper end —
// they prevent us from accidentally extracting a 12-digit prefix or suffix
// of a 13+ digit account number.
const CANDIDATE_RE = /(?<![$.\-\/\d])(\d{4,12})(?!\d|[\-\/])/;

export function extractCheckNumber(fullText, candidates = []) {
  if (fullText) {
    const banner = fullText.match(BANNER_RE);
    if (banner) return banner[1];
  }

  if (candidates.length === 0) return "";

  // Rightmost-first, topmost as tiebreaker.
  // Both x and y are normalized so higher = rightward / upward respectively.
  const ranked = [...candidates].sort((a, b) => b.x - a.x || b.y - a.y);
  return ranked[0].value;
}

// Helper for callers building the candidates array: returns the first valid
// 4-12 digit run inside the given string, or null. Used by frontPage.js to
// extract candidates from individual PDF.js text items / Tesseract words.
export function findCandidateInString(s) {
  if (!s) return null;
  const m = s.match(CANDIDATE_RE);
  return m ? m[1] : null;
}
