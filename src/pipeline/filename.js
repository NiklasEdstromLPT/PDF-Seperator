// Filename construction.
//
// Naming convention (per LPT AR procedure):
//   LPTR.<Check Number> - <Property Address>
//   e.g. "LPTR.123456 - 123 Main St.pdf"
//
// Two normalizations are applied automatically when building the name body
// from auto-extracted check# and address:
//   - leading zeros are stripped from the check number ("0098765" -> "98765")
//   - common street suffixes are abbreviated ("Street" -> "St", "Avenue" -> "Ave")
//
// All joining lives in this module so the convention is a single edit away.

const BODY_JOIN = " - ";          // between check# and address in the body
const PREFIX_JOIN = ".";          // between prefix and body when prefix lacks punctuation

// Filesystem-illegal characters across Windows/macOS/Linux. Spaces, dots, and
// hyphens are intentionally preserved — the new naming convention uses all three.
const ILLEGAL_RE = /[\x00-\x1f<>:"/\\|?*]/g;

export function sanitize(s) {
  return (s || "")
    .replace(ILLEGAL_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Strip leading zeros from a numeric string. Keeps a single "0" if the input
// is all zeros (don't return empty for "0000"). Non-digit input passes through.
export function stripLeadingZeros(s) {
  if (!s) return "";
  const t = String(s).trim();
  if (!/^\d+$/.test(t)) return t;
  return t.replace(/^0+(?=\d)/, "");
}

// Common US street-suffix abbreviations. Lowercased keys, canonical USPS-ish
// short forms as values. Only applied to the LAST word of the address — we
// don't want to rewrite "Park Avenue" into "Pk Ave".
//
// Already-abbreviated forms ("st", "ave", "rd", ...) are listed too so the
// transform is idempotent and so an input like "123 Main St." normalizes to
// "123 Main St" (trailing period stripped).
const SUFFIX_MAP = {
  street: "St", st: "St",
  avenue: "Ave", ave: "Ave", av: "Ave",
  road: "Rd", rd: "Rd",
  boulevard: "Blvd", blvd: "Blvd",
  drive: "Dr", dr: "Dr",
  lane: "Ln", ln: "Ln",
  court: "Ct", ct: "Ct",
  place: "Pl", pl: "Pl",
  parkway: "Pkwy", pkwy: "Pkwy",
  highway: "Hwy", hwy: "Hwy",
  circle: "Cir", cir: "Cir",
  terrace: "Ter", ter: "Ter",
  trail: "Trl", trl: "Trl",
  square: "Sq", sq: "Sq",
  crossing: "Xing", xing: "Xing",
  heights: "Hts", hts: "Hts",
  manor: "Mnr", mnr: "Mnr",
  ridge: "Rdg", rdg: "Rdg",
  cove: "Cv", cv: "Cv",
  path: "Path",
  way: "Way",
};

export function abbreviateStreetSuffix(addr) {
  if (!addr) return "";
  // Match the trailing word (allowing a trailing period) and replace if known.
  return addr.replace(/(\S+?)\.?(\s*)$/, (m, word, ws) => {
    const abbr = SUFFIX_MAP[word.toLowerCase()];
    return abbr ? abbr + ws : m;
  });
}

// Compose a final filename from prefix + body. If the prefix already ends in
// a punctuation/separator character (".", "-", or whitespace) we just concat;
// otherwise we insert a "." so e.g. a user-typed "LPTR" still produces
// "LPTR.123456 - …". Empty pieces drop. Falls back to "bundle.pdf" when both empty.
export function composeFilename(prefix, body) {
  const cleanBody = sanitize(body);
  const cleanPrefix = sanitize(prefix);

  if (!cleanPrefix && !cleanBody) return "bundle.pdf";
  if (!cleanBody) return cleanPrefix.replace(/[.\-\s]+$/, "") + ".pdf";
  if (!cleanPrefix) return cleanBody + ".pdf";

  const joined = /[.\-\s]$/.test(cleanPrefix)
    ? `${cleanPrefix}${cleanBody}`
    : `${cleanPrefix}${PREFIX_JOIN}${cleanBody}`;
  return joined + ".pdf";
}

// Build the editable name body shown on each review card from the auto-extracted
// check number and address. Either piece may be empty — the join handles that.
// Output: "<check#> - <address>" with leading zeros stripped from the check#
// and the trailing street suffix abbreviated.
export function buildNameBody(checkNumber, address) {
  const cn = stripLeadingZeros((checkNumber || "").trim());
  const addr = abbreviateStreetSuffix((address || "").trim());
  return [cn, addr].filter(Boolean).join(BODY_JOIN);
}

// Auto-suffix duplicates: "LPTR.Foo.pdf" -> "LPTR.Foo (2).pdf", "LPTR.Foo (3).pdf", ...
// Mutates `used` (a Set) so the caller can call it once per output file.
export function uniqueName(used, name) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const m = name.match(/^(.*)(\.pdf)$/i);
  const stem = m ? m[1] : name;
  const ext = m ? m[2] : "";
  let i = 2;
  while (used.has(`${stem} (${i})${ext}`)) i++;
  const out = `${stem} (${i})${ext}`;
  used.add(out);
  return out;
}
