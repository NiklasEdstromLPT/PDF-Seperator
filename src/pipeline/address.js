// US street address extraction.
//
// Strategy:
//   1. Walk every property-address-style label hit (Property Address, For,
//      Property, Subject Property, Premises, etc.). Each label requires a colon
//      to fire — that keeps us from matching "for example" or "property tax".
//   2. For each label match, look for the first address pattern in a BOUNDED
//      slice (~200 chars) immediately after the label. Bounding the slice
//      prevents a corrupted label line from silently reaching across the page
//      and pulling in some unrelated address.
//   3. Reject candidates that match a known-bad list — chiefly the LPT payee
//      address ("1400 South International Parkway"), which would otherwise
//      sometimes slip through.
//   4. If no labeled match in any window is valid, return "". We deliberately
//      do NOT fall back to first-match-wins on the whole page: in real packets
//      the first match is almost always the title company letterhead at the
//      top of the check, which is wrong. A blank result flags the card for
//      manual review — which is the correct behavior for the AR procedure's
//      "random company / no property address" exception case.

const LABEL_WINDOW = 220; // chars to scan after each label

// Shape: number + optional directional + 1-4 word street name + street type.
const ADDR_RE = new RegExp(
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

// Property-address labels. Most-specific first. Trailing colon required.
const PROPERTY_LABEL_RE = new RegExp(
  String.raw`\b(?:` +
    String.raw`property\s+address|subject\s+property|property\s+location|site\s+address|` +
    String.raw`premises|for|property` +
  String.raw`)\s*:\s+`,
  "ig"
);

// Addresses we should never return — chiefly the LPT payee block, which
// appears on every check and would otherwise leak through if the property
// label happens to land right before it.
const KNOWN_PAYEE_RES = [
  /1400\s+south\s+international\s+parkway/i,
  /lake\s+mary[,\s]+fl\s+32746/i,
];

export function extractAddress(text) {
  if (!text) return "";

  for (const label of text.matchAll(PROPERTY_LABEL_RE)) {
    const start = label.index + label[0].length;
    const slice = text.slice(start, start + LABEL_WINDOW);
    const m = slice.match(ADDR_RE);
    if (!m) continue;
    const candidate = clean(m[1]);
    if (isKnownPayee(candidate)) continue;
    return candidate;
  }

  return "";
}

function isKnownPayee(addr) {
  return KNOWN_PAYEE_RES.some((re) => re.test(addr));
}

function clean(s) {
  return s.replace(/\s+/g, " ").trim();
}
