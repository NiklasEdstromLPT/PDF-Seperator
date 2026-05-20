// Dev-mode diagnostic report.
//
// Builds a self-contained HTML file describing why each bundle's address
// detection landed where it did: the raw text the OCR/embedded-text pass
// produced, every label hit walked by scanWithLabels, the 220-char slice fed
// to the strict/loose regexes, and the eventual winning (or empty) candidate.
//
// Intended audience is the dev maintaining the address-extraction heuristics.
// Output is a single .html file with embedded styles and embedded thumbnail
// data URLs — opens in any browser, no tooling needed.
//
// Triggered from the "…" menu on the review screen; never runs during the
// normal user workflow.

export function downloadDiagnosticReport(state) {
  const html = buildDiagnosticReport(state);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function suggestFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `pdf-separator-diagnostics-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.html`;
}

export function buildDiagnosticReport(state) {
  const bundles = state.bundles || [];
  const summary = summarize(bundles);
  const now = new Date().toISOString();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>PDF-Separator diagnostic report</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<header>
  <h1>PDF-Separator diagnostic report</h1>
  <div class="meta">
    Generated ${escapeHtml(now)} ·
    ${bundles.length} bundle${bundles.length === 1 ? "" : "s"} ·
    prefix <code>${escapeHtml(state.prefix || "")}</code>
  </div>
</header>

<section class="summary">
  <h2>Summary</h2>
  <table class="kv">
    <tr><th>Total bundles</th><td>${bundles.length}</td></tr>
    <tr><th>Skipped</th><td>${summary.skipped}</td></tr>
    <tr><th>Address: strong</th><td>${summary.confStrong}</td></tr>
    <tr><th>Address: weak</th><td>${summary.confWeak}</td></tr>
    <tr><th>Address: none</th><td>${summary.confNone}</td></tr>
    <tr><th>Source: OCR</th><td>${summary.fromOcr}</td></tr>
    <tr><th>Source: spreadsheet (exact)</th><td>${summary.fromSheet}</td></tr>
    <tr><th>Source: spreadsheet (fuzzy)</th><td>${summary.fromSheetFuzzy}</td></tr>
    <tr><th>Page text: embedded</th><td>${summary.textEmbedded}</td></tr>
    <tr><th>Page text: OCR</th><td>${summary.textOcr}</td></tr>
    <tr title="Pages with a 'Property' / 'Address' / 'For' token in the raw text but no strong/weak match — the most likely 'we should have caught this' cases."><th>Suspicious misses</th><td>${summary.suspiciousMisses}</td></tr>
  </table>
  <p class="hint">
    “Suspicious misses” are bundles where the raw text contains a property/address
    label token but the address-extraction pass produced no candidate. These are
    the most likely sources of the 1-in-10 miss rate — start here.
  </p>
</section>

${bundles.map((b) => renderBundle(b, state.prefix || "")).join("\n")}
</body>
</html>`;
}

function summarize(bundles) {
  const s = {
    skipped: 0,
    confStrong: 0, confWeak: 0, confNone: 0,
    fromOcr: 0, fromSheet: 0, fromSheetFuzzy: 0,
    textEmbedded: 0, textOcr: 0,
    suspiciousMisses: 0,
  };
  for (const b of bundles) {
    if (b.skipped) s.skipped++;
    const c = b.addressConfidence;
    if (c === "strong") s.confStrong++;
    else if (c === "weak") s.confWeak++;
    else s.confNone++;
    if (b.addressSource === "spreadsheet") s.fromSheet++;
    else if (b.addressSource === "spreadsheet-fuzzy") s.fromSheetFuzzy++;
    else s.fromOcr++;
    const ts = b.diagnostics && b.diagnostics.textSource;
    if (ts === "embedded-text") s.textEmbedded++;
    else if (ts === "ocr") s.textOcr++;
    if (isSuspiciousMiss(b)) s.suspiciousMisses++;
  }
  return s;
}

function isSuspiciousMiss(b) {
  if (!b.diagnostics) return false;
  if (b.addressConfidence !== "none") return false;
  const mentions = b.diagnostics.addressTrace?.propertyMentions || [];
  // Any mention of a property/address label means the page should have had
  // something to grab — flag it.
  return mentions.length > 0;
}

function renderBundle(b, prefix) {
  const d = b.diagnostics || {};
  const trace = d.addressTrace || { pass1: { labelHits: [] }, pass2: { labelHits: [] }, propertyMentions: [] };
  const suspicious = isSuspiciousMiss(b);
  const tags = [];
  if (b.skipped) tags.push(`<span class="tag skip">skipped</span>`);
  tags.push(`<span class="tag conf-${b.addressConfidence || "none"}">${escapeHtml(b.addressConfidence || "none")}</span>`);
  tags.push(`<span class="tag src">${escapeHtml(b.addressSource || "ocr")}</span>`);
  if (d.textSource) tags.push(`<span class="tag txt">${escapeHtml(d.textSource)}</span>`);
  if (suspicious) tags.push(`<span class="tag suspicious">⚠ suspicious miss</span>`);

  const filename = `${prefix}${b.nameBody || ""}.pdf`;

  return `
<details class="bundle${suspicious ? " is-suspicious" : ""}" ${suspicious || b.addressConfidence !== "strong" ? "open" : ""}>
  <summary>
    <span class="idx">#${String(b.index + 1).padStart(2, "0")}</span>
    <span class="addr">${b.address ? escapeHtml(b.address) : "<em>no address</em>"}</span>
    <span class="check">${b.checkNumber ? "check# " + escapeHtml(b.checkNumber) : ""}</span>
    <span class="tags">${tags.join("")}</span>
  </summary>

  <div class="bundle-body">
    <div class="bundle-grid">
      <div class="thumb-col">
        ${renderThumb(b)}
      </div>

      <div class="data-col">
        <table class="kv">
          <tr><th>Final filename</th><td><code>${escapeHtml(filename)}</code></td></tr>
          <tr><th>Pages (1-based)</th><td>${(b.pages || []).map((p) => p + 1).join(", ")}</td></tr>
          <tr><th>Address</th><td>${b.address ? `<code>${escapeHtml(b.address)}</code>` : "<em>(empty)</em>"}</td></tr>
          <tr><th>Confidence</th><td>${escapeHtml(b.addressConfidence || "none")}</td></tr>
          <tr><th>Source</th><td>${escapeHtml(b.addressSource || "ocr")}</td></tr>
          <tr><th>Check#</th><td>${b.checkNumber ? `<code>${escapeHtml(b.checkNumber)}</code>` : "<em>(empty)</em>"}</td></tr>
          <tr><th>Text source</th><td>${escapeHtml(d.textSource || "unknown")}</td></tr>
          <tr><th>Raw text length</th><td>${d.rawTextLen ?? 0} chars</td></tr>
          <tr><th>Check candidates</th><td>${d.candidatesCount ?? 0}</td></tr>
          ${d.textSource === "ocr" ? `<tr><th>OCR</th><td>PSM1, rotation ${d.rotation ?? 0}°${d.orientationConfidence != null ? `, orient-conf ${formatNum(d.orientationConfidence)}` : ""}${d.ocrMeanConfidence != null ? `, mean-conf ${formatNum(d.ocrMeanConfidence)}` : ""}</td></tr>` : ""}
          ${b.addressLookupMatch ? `<tr><th>Spreadsheet match</th><td>check# <code>${escapeHtml(b.addressLookupMatch.matchedCheck || "")}</code> (${escapeHtml(b.addressLookupMatch.kind || "")}, distance ${b.addressLookupMatch.distance ?? "?"})</td></tr>` : ""}
        </table>

        ${renderOcrAddressBlock(d.ocrAddress)}
      </div>
    </div>

    <h3>Address-scan trace</h3>
    ${renderPass(trace.pass1, "Pass 1 — labels with colon")}
    ${renderPass(trace.pass2, "Pass 2 — labels without colon (fallback)")}

    <h3>Raw-text label mentions
      <span class="hint-inline">(every property/address/for token in the raw text, with or without colon)</span>
    </h3>
    ${renderPropertyMentions(trace.propertyMentions)}

    <h3>Raw text dump</h3>
    <details class="raw-text">
      <summary>Show raw text (${d.rawTextLen ?? 0} chars)</summary>
      <pre>${escapeHtml(d.rawText || "")}</pre>
    </details>
  </div>
</details>`;
}

// Thumbnail with check# and address highlight overlays — same yellow-marker
// look as the review screen. Bbox coords are page-percent, so positioning is
// just `left/top/width/height` in % on absolute divs over the image.
function renderThumb(b) {
  if (!b.thumbnail) return `<div class="thumb missing">no thumbnail</div>`;
  const marks = [];
  const h = b.highlights || {};
  for (const key of ["check", "address"]) {
    const bb = h[key];
    if (!bb) continue;
    const padX = 0.4, padY = 0.4;
    const left = Math.max(0, bb.x - padX);
    const top = Math.max(0, bb.y - padY);
    const width = bb.w + padX * 2;
    const height = bb.h + padY * 2;
    marks.push(
      `<div class="hl hl-${key}" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"></div>`
    );
  }
  const missing = [];
  if (!h.check && b.checkNumber) missing.push("check#");
  if (!h.address && b.address) missing.push("address");
  const missingNote = missing.length
    ? `<div class="hl-missing">No bbox located on page for: ${missing.join(", ")}</div>`
    : "";
  return `
    <div class="thumb-wrap">
      <img class="thumb" src="${b.thumbnail}" alt="Front page of bundle ${b.index + 1}">
      ${marks.join("")}
    </div>
    ${missingNote}`;
}

function renderOcrAddressBlock(ocr) {
  if (!ocr) return "";
  return `<div class="ocr-only">
    <strong>OCR-only address:</strong>
    ${ocr.value ? `<code>${escapeHtml(ocr.value)}</code>` : "<em>(none)</em>"}
    <span class="dim">(confidence: ${escapeHtml(ocr.confidence || "none")})</span>
  </div>`;
}

function renderPass(pass, title) {
  if (!pass) return "";
  if (!pass.ran) {
    return `<div class="pass not-run"><h4>${escapeHtml(title)}</h4><p class="dim">Not run (pass 1 produced a result).</p></div>`;
  }
  const hits = pass.labelHits || [];
  if (hits.length === 0) {
    return `<div class="pass"><h4>${escapeHtml(title)}</h4><p class="dim">No label matches in raw text.</p></div>`;
  }
  return `<div class="pass">
    <h4>${escapeHtml(title)} <span class="dim">(${hits.length} label hit${hits.length === 1 ? "" : "s"})</span></h4>
    <table class="trace">
      <thead><tr>
        <th>#</th><th>Label</th><th>Slice (after label, post-trim)</th>
        <th>Strict</th><th>Loose</th>
      </tr></thead>
      <tbody>
        ${hits.map((h, i) => renderLabelHit(h, i)).join("")}
      </tbody>
    </table>
  </div>`;
}

function renderLabelHit(h, i) {
  return `<tr>
    <td class="num">${i + 1}</td>
    <td><code>${escapeHtml(h.label)}</code><div class="dim small">idx ${h.index}</div></td>
    <td><pre class="slice">${escapeHtml(h.slice || "")}</pre></td>
    <td>${renderRegexResult(h.strict)}</td>
    <td>${renderRegexResult(h.loose)}</td>
  </tr>`;
}

function renderRegexResult(r) {
  if (!r) return "<em>—</em>";
  if (!r.matched) return `<span class="dim">no match</span>`;
  const badge = r.accepted
    ? `<span class="badge ok">accepted</span>`
    : `<span class="badge bad">rejected${r.rejection ? " · " + escapeHtml(r.rejection) : ""}</span>`;
  return `<code class="val">${escapeHtml(r.value)}</code><br>${badge}`;
}

function renderPropertyMentions(mentions) {
  if (!mentions || mentions.length === 0) {
    return `<p class="dim">No property/address/for tokens found in raw text.</p>`;
  }
  return `<table class="mentions">
    <thead><tr><th>Token</th><th>Colon?</th><th>Context</th></tr></thead>
    <tbody>
      ${mentions.map((m) => `<tr>
        <td><code>${escapeHtml(m.token)}</code><div class="dim small">idx ${m.index}</div></td>
        <td>${m.hasColon ? "✓" : "<span class=\"dim\">—</span>"}</td>
        <td><pre class="context">${escapeHtml(m.context || "")}</pre></td>
      </tr>`).join("")}
    </tbody>
  </table>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNum(n) {
  const v = Number(n);
  if (!isFinite(v)) return "?";
  return Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1);
}

const REPORT_CSS = `
:root {
  --bg: #f7f3ec; --bg-elev: #fbf8f1; --ink: #1c1a17; --ink-soft: #5a5650;
  --ink-faint: #8a857d; --line: #e2dccc; --line-strong: #cdc5b1;
  --accent: #3f6361; --warn: #b06b1a; --warn-bg: #fdf3e3; --ok: #3f7a4f;
  --bad: #a13a2c; --bad-bg: #fbe8e3;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: 14px; line-height: 1.5; }
header { background: var(--bg-elev); border-bottom: 1px solid var(--line); padding: 20px 28px; }
header h1 { margin: 0 0 4px; font-size: 20px; }
header .meta { font-family: var(--mono); font-size: 12px; color: var(--ink-faint); }
header code { background: var(--bg); padding: 1px 5px; border-radius: 3px; }
section.summary, details.bundle { margin: 18px 28px; background: var(--bg-elev); border: 1px solid var(--line); border-radius: 8px; padding: 16px 20px; }
section.summary h2 { margin: 0 0 12px; font-size: 16px; }
.kv { border-collapse: collapse; font-size: 13px; }
.kv th, .kv td { text-align: left; padding: 3px 12px 3px 0; vertical-align: top; }
.kv th { font-weight: 600; color: var(--ink-soft); font-family: var(--mono); font-size: 12px; }
.kv code { background: var(--bg); padding: 1px 5px; border-radius: 3px; font-size: 12px; }
.hint { font-size: 12px; color: var(--ink-faint); margin: 10px 0 0; max-width: 720px; }
.hint-inline { font-weight: normal; color: var(--ink-faint); font-size: 12px; }

details.bundle > summary { cursor: pointer; padding: 4px 0; display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; user-select: none; }
details.bundle > summary::-webkit-details-marker { color: var(--ink-faint); }
details.bundle.is-suspicious { border-color: var(--warn); border-left-width: 4px; }
.idx { font-family: var(--mono); font-weight: 700; color: var(--ink); }
.addr { font-family: var(--mono); flex: 1; min-width: 200px; }
.addr em { color: var(--ink-faint); font-style: italic; }
.check { font-family: var(--mono); color: var(--ink-soft); font-size: 12px; }
.tags { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.tag { font-family: var(--mono); font-size: 11px; padding: 1px 6px; border-radius: 3px; background: var(--bg); border: 1px solid var(--line); color: var(--ink-soft); }
.tag.conf-strong { background: #eef5ee; border-color: var(--ok); color: var(--ok); }
.tag.conf-weak { background: var(--warn-bg); border-color: var(--warn); color: var(--warn); }
.tag.conf-none { background: var(--bad-bg); border-color: var(--bad); color: var(--bad); }
.tag.suspicious { background: var(--warn-bg); border-color: var(--warn); color: var(--warn); font-weight: 600; }
.tag.skip { background: #eee; color: var(--ink-faint); }

.bundle-body { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line); }
.bundle-grid { display: grid; grid-template-columns: 240px 1fr; gap: 20px; align-items: start; }
@media (max-width: 800px) { .bundle-grid { grid-template-columns: 1fr; } }
.thumb-wrap { position: relative; line-height: 0; border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
.thumb { width: 100%; display: block; }
.thumb.missing { padding: 40px; text-align: center; color: var(--ink-faint); border: 1px solid var(--line); border-radius: 4px; }
.hl {
  position: absolute;
  pointer-events: none;
  border-radius: 2px;
  background: rgba(252, 211, 77, 0.55);
  mix-blend-mode: multiply;
  outline: 1px solid rgba(176, 107, 26, 0.55);
}
.hl-check { background: rgba(120, 180, 200, 0.45); outline-color: rgba(63, 99, 97, 0.6); }
.hl-missing { font-size: 11px; color: var(--warn); font-family: var(--mono); margin-top: 6px; line-height: 1.4; }

.ocr-only { margin-top: 8px; padding: 6px 10px; background: var(--bg); border-radius: 4px; font-size: 13px; }
.ocr-only code { background: var(--bg-elev); padding: 1px 5px; border-radius: 3px; }
.dim { color: var(--ink-faint); }
.small { font-size: 11px; }

h3 { margin: 18px 0 8px; font-size: 14px; }
h4 { margin: 12px 0 6px; font-size: 13px; }
.pass.not-run { color: var(--ink-faint); }
table.trace, table.mentions { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
table.trace th, table.trace td, table.mentions th, table.mentions td {
  border: 1px solid var(--line); padding: 6px 8px; vertical-align: top; text-align: left;
}
table.trace th, table.mentions th { background: var(--bg); font-family: var(--mono); font-size: 11px; color: var(--ink-soft); }
.num { font-family: var(--mono); color: var(--ink-faint); text-align: right; width: 28px; }
pre.slice, pre.context { font-family: var(--mono); font-size: 11px; white-space: pre-wrap; word-break: break-word; margin: 0; max-width: 540px; }
code.val { background: var(--bg); padding: 1px 5px; border-radius: 3px; font-size: 11px; }
.badge { display: inline-block; font-family: var(--mono); font-size: 10px; padding: 1px 6px; border-radius: 3px; margin-top: 4px; }
.badge.ok { background: #eef5ee; color: var(--ok); border: 1px solid var(--ok); }
.badge.bad { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn); }

details.raw-text { margin-top: 8px; }
details.raw-text > summary { cursor: pointer; font-family: var(--mono); font-size: 12px; color: var(--ink-soft); }
details.raw-text pre {
  font-family: var(--mono); font-size: 11px; background: var(--bg); border: 1px solid var(--line);
  border-radius: 4px; padding: 10px 12px; white-space: pre-wrap; word-break: break-word;
  max-height: 480px; overflow: auto; margin-top: 6px;
}
`;
