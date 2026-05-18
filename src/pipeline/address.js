// US street address extraction.
//
// Three-tier match confidence:
//   strong — strict regex matched (number + dir? + 1-4 words + KNOWN suffix)
//   weak   — loose regex matched (same shape, ANY capitalized word as the ending)
//   none   — neither matched
//
// Two-pass label scan:
//   Pass 1 (priority) — labels with a trailing colon. Highest signal.
//   Pass 2 (fallback) — same labels WITHOUT a colon. Only runs if pass 1
//     produces nothing. OCR sometimes drops/misreads colons, and some packets
//     just don't punctuate consistently. The colonless variants of generic
//     labels like "for" / "property" / "address" can drag in false positives,
//     so we only reach for them when the cleaner pass returned empty.
//
// Within each pass we try strict on EVERY labeled position before falling
// back to the best weak candidate. That way a packet with both a
// "Property Address: 123 Main Way" and a "For: 456 Sunset Sunrise" returns
// the strong "Main Way" match, not the weak one — even though the weak label
// might appear first.
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

// Words that look like a "suffix" by capitalization but actually mean unit/floor,
// or are closing-summary labels that sit on the line right after the address —
// don't accept them as a weak match (otherwise "1234 Main Apartment" or
// "1234 Pear Mews Memo" looks like a complete address when it's actually
// missing the real suffix and bleeding into the next field).
const LOOSE_STOP_LIST = new Set([
  "apartment", "apt",
  "suite", "ste",
  "unit",
  "floor", "fl",
  "building", "bldg",
  // Closing-summary labels — when the address line lacks a known suffix,
  // PDF text concatenation can paste the next line's label word right after.
  "memo", "address", "buyer", "borrower", "seller", "lender",
  "settlement", "disbursement", "property", "description", "page",
  "check", "pay", "lpt",
]);

// Suffixes used to detect the "Drive St. Louis" trap in fixDoubleSuffix below.
// Only the unambiguous full-word and short-form street types — intentionally
// excludes midword-friendly types like Glen / Park / Run / Bend / Ridge / Cove
// (since "Autumn Glen Lane" is a legitimate address that shouldn't trigger).
const TWO_SUFFIX_PREV_SET = new Set([
  "street", "st",
  "avenue", "ave", "av",
  "road", "rd",
  "boulevard", "blvd",
  "drive", "dr",
  "lane", "ln",
  "court", "ct",
  "place", "pl",
  "way",
  "parkway", "pkwy",
  "highway", "hwy",
  "circle", "cir",
  "terrace", "ter",
  "trail", "trl",
  "plaza",
  "square", "sq",
]);

// Trailing tokens that are almost always city-prefix abbreviations (Saint Louis,
// Mount Olive, Fort Wayne) when they show up right after a real street suffix.
const TWO_SUFFIX_LAST_SET = new Set(["st", "ste", "mt", "ft", "sta"]);

// Closing-summary labels that follow the property address. Used to truncate
// the slice so the regex can't reach past them onto the next field.
const NEXT_LABEL_RE =
  /\s+(?:memo|buyer\/borrower|borrower|seller|lender|settlement\s+date|disbursement\s+date|check\s+amount|pay\s+to|property\s+address|property|description|page|for)\s*:/i;

// Property-address labels — order matters: most-specific multi-word forms
// FIRST so the regex engine matches them before their shorter prefixes
// ("Property Address" before "Property", "Buyer Address" before "Address").
const LABEL_ALTERNATION =
  String.raw`property\s+address|subject\s+property|property\s+location|site\s+address|` +
  String.raw`buyer\s+address|seller\s+address|file\s+no\.?|` +
  String.raw`premises|description|location|address|memo|property|for`;

// Pass 1 (priority): colon required.
const PROPERTY_LABEL_RE_STRICT = new RegExp(
  String.raw`\b(?:` + LABEL_ALTERNATION + String.raw`)\s*:\s+`,
  "ig"
);

// Pass 2 (fallback): same labels, no colon — just whitespace before the
// candidate address. Only consulted when the colon pass returns nothing.
const PROPERTY_LABEL_RE_LOOSE = new RegExp(
  String.raw`\b(?:` + LABEL_ALTERNATION + String.raw`)\s+`,
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

  // Pass 1: colon-required labels (high signal).
  const pass1 = scanWithLabels(text, PROPERTY_LABEL_RE_STRICT);
  if (pass1.confidence !== "none") return pass1;

  // Pass 2: same labels, colon-optional. Only consulted when pass 1 returned
  // nothing, since colonless generics ("for", "property", "address") can
  // attract false positives from prose.
  return scanWithLabels(text, PROPERTY_LABEL_RE_LOOSE);
}

function scanWithLabels(text, labelRe) {
  let bestWeak = null;

  for (const label of text.matchAll(labelRe)) {
    const start = label.index + label[0].length;
    const rawSlice = text.slice(start, start + LABEL_WINDOW);
    // Stop the slice at the next closing-summary label so multi-line addresses
    // can't bleed onto the next field (e.g. address line 2 + "Memo:").
    const slice = trimAtNextLabel(rawSlice);

    // Try strict first — if any label produces a strong match, we're done.
    const strict = slice.match(STRICT_ADDR_RE);
    if (strict) {
      const candidate = fixDoubleSuffix(clean(strict[1]));
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

// Dev-mode diagnostic. Re-runs the same scan logic as extractAddress() but
// records every step — label hits, slices, regex outcomes, rejection reasons —
// so the dev report can show *why* a given page produced (or failed to produce)
// an address. Pure observation; never mutates state and never affects the
// production extraction path.
//
// Shape:
//   {
//     final: { value, confidence },
//     pass1: { ran, labelHits: [...], result },
//     pass2: { ran, labelHits: [...], result },
//     propertyMentions: [{ token, index, context, hasColon }]
//   }
//
// Each labelHit:
//   {
//     label: matched label text (e.g. "Property Address: "),
//     index: position in raw text,
//     slice: 220-char window after the label (post-trim),
//     rawSlice: same window before next-label trim,
//     strict: { matched, value, accepted, rejection } | null,
//     loose:  { matched, value, accepted, rejection } | null
//   }
export function traceAddressScan(text) {
  const trace = {
    final: { value: "", confidence: "none" },
    pass1: { ran: false, labelHits: [], result: null },
    pass2: { ran: false, labelHits: [], result: null },
    propertyMentions: collectPropertyMentions(text),
  };
  if (!text) return trace;

  trace.pass1.ran = true;
  trace.pass1.result = traceScan(text, PROPERTY_LABEL_RE_STRICT, trace.pass1.labelHits);
  if (trace.pass1.result.confidence !== "none") {
    trace.final = trace.pass1.result;
    return trace;
  }

  trace.pass2.ran = true;
  trace.pass2.result = traceScan(text, PROPERTY_LABEL_RE_LOOSE, trace.pass2.labelHits);
  trace.final = trace.pass2.result;
  return trace;
}

function traceScan(text, labelRe, labelHits) {
  let bestWeak = null;
  let returnedStrong = null;

  for (const label of text.matchAll(labelRe)) {
    const start = label.index + label[0].length;
    const rawSlice = text.slice(start, start + LABEL_WINDOW);
    const slice = trimAtNextLabel(rawSlice);

    const hit = {
      label: label[0],
      index: label.index,
      slice,
      rawSlice,
      strict: null,
      loose: null,
    };

    const strictMatch = slice.match(STRICT_ADDR_RE);
    if (strictMatch) {
      const candidate = fixDoubleSuffix(clean(strictMatch[1]));
      const isPayee = isKnownPayee(candidate);
      hit.strict = {
        matched: true,
        value: candidate,
        accepted: !isPayee && returnedStrong === null,
        rejection: isPayee ? "known-payee" : null,
      };
      if (!isPayee && returnedStrong === null) {
        returnedStrong = { value: candidate, confidence: "strong" };
      }
    } else {
      hit.strict = { matched: false, value: "", accepted: false, rejection: null };
    }

    const looseMatch = slice.match(LOOSE_ADDR_RE);
    if (looseMatch) {
      const candidate = clean(looseMatch[1]);
      const lastWord = candidate.split(/\s+/).pop().toLowerCase();
      const stopHit = LOOSE_STOP_LIST.has(lastWord);
      const isPayee = isKnownPayee(candidate);
      let rejection = null;
      if (stopHit) rejection = `loose-stop-list (last word: "${lastWord}")`;
      else if (isPayee) rejection = "known-payee";
      const accepted = !stopHit && !isPayee && bestWeak === null && returnedStrong === null;
      hit.loose = { matched: true, value: candidate, accepted, rejection };
      if (!stopHit && !isPayee && bestWeak === null) {
        bestWeak = { value: candidate, confidence: "weak" };
      }
    } else {
      hit.loose = { matched: false, value: "", accepted: false, rejection: null };
    }

    labelHits.push(hit);
    if (returnedStrong) break;
  }

  if (returnedStrong) return returnedStrong;
  return bestWeak || { value: "", confidence: "none" };
}

// Find every "property" / "address" / "for" token in raw text whether or not
// it carries a colon. Useful for spotting cases where OCR ate the colon and
// the strict pass walked right past a real label.
const RAW_MENTION_RE =
  /\b(property\s+address|property|address|premises|location|description|memo|for|file\s*no\.?)\b\s*(:)?/ig;

function collectPropertyMentions(text) {
  if (!text) return [];
  const out = [];
  for (const m of text.matchAll(RAW_MENTION_RE)) {
    const idx = m.index;
    out.push({
      token: m[1],
      hasColon: !!m[2],
      index: idx,
      // ±60 chars of context around the label, with the matched span itself
      // surrounded by «…» so it's easy to spot in the report.
      context: contextSnippet(text, idx, m[0].length),
    });
  }
  return out;
}

function contextSnippet(text, idx, len, pad = 60) {
  const start = Math.max(0, idx - pad);
  const end = Math.min(text.length, idx + len + pad);
  const before = text.slice(start, idx);
  const match = text.slice(idx, idx + len);
  const after = text.slice(idx + len, end);
  return `${start > 0 ? "…" : ""}${before}«${match}»${after}${end < text.length ? "…" : ""}`;
}

function trimAtNextLabel(slice) {
  const idx = slice.search(NEXT_LABEL_RE);
  return idx > 0 ? slice.slice(0, idx) : slice;
}

// Strip a trailing one-word "suffix" that's actually a city-prefix abbreviation.
// Triggers only when the captured address ends in St/Ste/Mt/Ft AND the word
// just before it is itself a real street suffix — that combination almost
// always means the regex grabbed "Drive St. Louis" or "Lane Mt. Olive" and
// included the city prefix by mistake. "Autumn Glen Lane" is safe because
// the prev-word check excludes ambiguous midword tokens like Glen.
function fixDoubleSuffix(addr) {
  const words = addr.trim().split(/\s+/);
  if (words.length < 4) return addr;
  const last = words[words.length - 1].toLowerCase().replace(/\.$/, "");
  const prev = words[words.length - 2].toLowerCase().replace(/\.$/, "");
  if (TWO_SUFFIX_LAST_SET.has(last) && TWO_SUFFIX_PREV_SET.has(prev)) {
    return words.slice(0, -1).join(" ");
  }
  return addr;
}

function isKnownPayee(addr) {
  return KNOWN_PAYEE_RES.some((re) => re.test(addr));
}

function clean(s) {
  return s.replace(/\s+/g, " ").trim();
}
