// US street address extraction.
//
// Strategy:
//   1. If the text contains a "Property Address" / "Subject Property" / "Premises"
//      style label, look for the first address match AFTER the label. This avoids
//      picking up the title company's letterhead address at the top of the page.
//   2. Fall back to first-match-wins on the whole text.
//
// Shape of the regex: number + optional directional + 1-4 word street name + street type.

const ADDR_RE = new RegExp(
  String.raw`\b(\d{1,6}\s+` +
    String.raw`(?:(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West|Northeast|Northwest|Southeast|Southwest)\.?\s+)?` +
    String.raw`(?:[A-Za-z][A-Za-z0-9'\.\-]*\s+){1,4}` +
    String.raw`(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Ter|Terrace|Trl|Trail|Loop|Plaza|Sq|Square|Run)` +
    String.raw`)\b\.?`,
  "i"
);

const PROPERTY_LABEL_RE = new RegExp(
  String.raw`\b(?:property\s*address|subject\s*property|premises|property\s*location|site\s*address)\b\s*[:\-]?\s+`,
  "i"
);

export function extractAddress(text) {
  if (!text) return "";

  const label = text.match(PROPERTY_LABEL_RE);
  if (label) {
    const after = text.slice(label.index + label[0].length);
    const m = after.match(ADDR_RE);
    if (m) return clean(m[1]);
  }

  const m = text.match(ADDR_RE);
  return m ? clean(m[1]) : "";
}

function clean(s) {
  return s.replace(/\s+/g, " ").trim();
}
