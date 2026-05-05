// Walk the page list. Runs of consecutive red separator pages collapse into a single
// boundary (duplex scanners produce two-page red sheets). Empty bundles between
// adjacent separator runs are dropped silently. Returns an array of page-index arrays.
export function splitBundles(numPages, redSet) {
  const groups = [];
  let cur = [];
  for (let i = 0; i < numPages; i++) {
    if (redSet.has(i)) {
      if (cur.length > 0) {
        groups.push(cur);
        cur = [];
      }
    } else {
      cur.push(i);
    }
  }
  if (cur.length > 0) groups.push(cur);
  return groups;
}
