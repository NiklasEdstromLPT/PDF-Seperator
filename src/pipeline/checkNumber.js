// Check number extraction.
//
// Real packet front pages always carry a check number in two places: the top-right
// of the check itself, and immediately after the "**** REAL ESTATE CLOSING ****"
// banner in the closing summary. The banner form is the most reliable signal
// because it isolates the number from surrounding noise (the dollar amount,
// page numbers, escrow IDs, etc. all look like 4–8 digit numbers too).
//
// Tries the banner form first; if that fails, falls back to a stand-alone digit
// run near the top of the text. Returns "" when nothing plausible is found.

const BANNER_RE = /\*+\s*REAL\s*ESTATE\s*CLOSING\s*\*+\s*(\d{3,8})\b/i;

// Loose fallback: a 4–8 digit run that's NOT preceded by "$", ".", "-", "/" or
// followed by another digit (so we skip dollar amounts and dates).
const LOOSE_RE = /(?<![$.\-\/\d])(\d{4,8})(?!\d|[\-\/])/;

export function extractCheckNumber(text) {
  if (!text) return "";

  const banner = text.match(BANNER_RE);
  if (banner) return banner[1];

  // Look in just the first ~600 chars — the check number prints near the top.
  // This keeps us from grabbing escrow numbers ("Escrow Number: 77-8219-238")
  // or dollar amounts ("$13,741.19") farther down the page.
  const head = text.slice(0, 600);
  const loose = head.match(LOOSE_RE);
  return loose ? loose[1] : "";
}
