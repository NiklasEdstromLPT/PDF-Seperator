// Sanitize an address-ish string into a safe filename body.
export function sanitize(s) {
  return (s || "")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Auto-suffix duplicates: "Foo.pdf" -> "Foo-2.pdf", "Foo-3.pdf", ...
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
  while (used.has(`${stem}-${i}${ext}`)) i++;
  const out = `${stem}-${i}${ext}`;
  used.add(out);
  return out;
}
