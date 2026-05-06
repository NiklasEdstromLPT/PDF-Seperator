// Filename construction.
//
// Naming convention (per LPT AR procedure):
//   LPTR <Check Number> <Property Address>
// Rendered with hyphens for filesystem-friendliness:
//   "LPTR-462057-54023-Driftwood-Avenue.pdf"
//
// The convention can change later — keeping all the joining logic in this
// one module so flipping spaces ↔ hyphens is a single edit.

const SEP = "-";

// Hyphenate a free-form string into a filename body. Whitespace runs collapse
// to a single hyphen; non-alphanumeric characters drop. Result has no leading
// or trailing hyphens and no double hyphens.
export function sanitize(s) {
  return (s || "")
    .replace(/\s+/g, SEP)
    .replace(/[^A-Za-z0-9-]/g, "")
    .replace(/-+/g, SEP)
    .replace(/^-+|-+$/g, "");
}

// Compose a final filename from prefix + body. The prefix often already ends
// in `-` (the default `LPTR-`), so we don't add an extra one between prefix
// and body. Empty pieces drop. Falls back to "bundle.pdf" when both empty.
export function composeFilename(prefix, body) {
  const cleanBody = sanitize(body);
  const cleanPrefix = (prefix || "").replace(/[\x00-\x1f<>:"/\\|?*]/g, "").trim();

  if (!cleanPrefix && !cleanBody) return "bundle.pdf";
  if (!cleanBody) return cleanPrefix.replace(/-+$/, "") + ".pdf";
  if (!cleanPrefix) return cleanBody + ".pdf";
  // If prefix already ends in a separator, just concat; else join with one.
  return cleanPrefix.endsWith(SEP)
    ? `${cleanPrefix}${cleanBody}.pdf`
    : `${cleanPrefix}${SEP}${cleanBody}.pdf`;
}

// Build the editable name body shown on each review card from the auto-extracted
// check number and address. Either piece may be empty — the join handles that.
// Output: "<check#>-<address>" sanitized, e.g. "462057-54023-Driftwood-Avenue".
export function buildNameBody(checkNumber, address) {
  const parts = [sanitize(checkNumber), sanitize(address)].filter(Boolean);
  return parts.join(SEP);
}

// Auto-suffix duplicates: "LPTR-Foo.pdf" -> "LPTR-Foo-2.pdf", "LPTR-Foo-3.pdf", ...
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
  while (used.has(`${stem}${SEP}${i}${ext}`)) i++;
  const out = `${stem}${SEP}${i}${ext}`;
  used.add(out);
  return out;
}
