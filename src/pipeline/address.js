// US street address extraction.
//
// Three-tier extraction:
//   strong — strict regex matched (number + dir? + 1-4 words + KNOWN suffix)
//   weak   — loose regex matched (same shape, ANY capitalized word as the ending)
//   none   — neither matched
//
// We try strict on EVERY labeled position before falling back to the best weak
// candidate. That way a packet with both a "Property Address: 123 Main Way" and
// a "For: 456 Sunset Sunrise" returns the strong "Main Way" match, not the
// weak "Sunset Sunrise" one — even though the weak label might appear first.
//
// Returns: { value: string, confidence: "strong" | "weak" | "none" }
//
// Why no first-match-wins fallback on the whole page: real packets put the
// title company's letterhead at the top of the check; first-match would
// silently grab it. We require a label so we always return a property
// address (or nothing).

const LABEL_WINDOW = 220; // chars to scan after each label

// Strict shape — known street suffix. ~95-97% of US addresses, ~98%+ of LPT closings.
const STRICT_ADDR_RE = new RegExp(
  String.raw`\b(\d{1,6}\s+` +
    String.raw`(?:(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West|Northeast|Northwest|Southeast|Southwest)\.?\s+)?` +
    String.raw`(?:[A-Za-z][A-Za-z0-9'\.\-]*\s+){1,4}` +
    String.raw`(?:` +
      String.raw`St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|` +
      String.raw`Ct|Court|Pl|Place|Way|Pkwy|Parkway|Hwy|Highway|Cir|Circle|` +
      String.raw`Ter|Terrace|Trl|Trail|Loop|Plaza|Sq|Square|Run|Crossing|Park|` +
      String.raw`Path|Walk|Pass|Glen|Heights|Manor|Bend|Ridge|Cove|Row` +
    String.raw`)` +
    String.raw`)\b\.?`,
  "i"
);

// Loose shape — same structure, but the suffix slot accepts ANY capitalized
// word ≥3 chars. Catches "Sunrise", "Meadow", "Trace", "Mews" etc. without us
// having to enumerate every possible suffix in the country.
const LOOSE_ADDR_RE = new RegExp(
  String.raw`\b(\d{1,6}\s+` +
    String.raw`(?:(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West|Northeast|Northwest|Southeast|Southwest)\.?\s+)?` +
    String.raw`(?:[A-Za-z][A-Za-z0-9'\.\-]*\s+){1,4}` +
    String.raw`[A-Z][a-z]{2,})\b\.?`
);

// Words that look like a "suffix" by capitalization but actually mean unit/floor —
// don't accept them as a weak match (otherwise "1234 Main Apartment" looks like
// a complete address when it's just missing the real suffix).
const LOOSE_STOP_LIST = new Set([
  "apartment", "apt",
  "suite", "ste",
  "unit",
  "floor", "fl",
  "building", "bldg",
]);

// Property-address labels. Most-specific first. Trailing colon required.
const PROPERTY_LABEL_RE = new RegExp(
  String.raw`\b(?:` +
    String.raw`property\s+address|subject\s+property|property\s+location|site\s+address|` +
    String.raw`premises|for|property` +
  String.raw`)\s*:\s+`,
  "ig"
);

// Addresses we should never return — chiefly the LPT payee block, which
// appears on every check and would otherwise leak through if a property
// label happens to land right before it.
const KNOWN_PAYEE_RES = [
  /1400\s+south\s+international\s+parkway/i,
  /lake\s+mary[,\s]+fl\s+32746/i,
];

const NONE = Object.freeze({ value: "", confidence: "none" });

export function extractAddress(text) {
  if (!text) return NONE;

  let bestWeak = null;

  for (const label of text.matchAll(PROPERTY_LABEL_RE)) {
    const start = label.index + label[0].length;
    const slice = text.slice(start, start + LABEL_WINDOW);

    // Try strict first — if any label produces a strong match, we're done.
    const strict = slice.match(STRICT_ADDR_RE);
    if (strict) {
      const candidate = clean(strict[1]);
      if (!isKnownPayee(candidate)) {
        return { value: candidate, confidence: "strong" };
      }
    }

    // Try loose — keep the first valid loose match as a fallback while we
    // continue looking for a strict one in subsequent labels.
    if (!bestWeak) {
      const loose = slice.match(LOOSE_ADDR_RE);
      if (loose) {
        const candidate = clean(loose[1]);
        const lastWord = candidate.split(/\s+/).pop().toLowerCase();
        if (!LOOSE_STOP_LIST.has(lastWord) && !isKnownPayee(candidate)) {
          bestWeak = { value: candidate, confidence: "weak" };
        }
      }
    }
  }

  return bestWeak || NONE;
}

function isKnownPayee(addr) {
  return KNOWN_PAYEE_RES.some((re) => re.test(addr));
}

function clean(s) {
  return s.replace(/\s+/g, " ").trim();
}
