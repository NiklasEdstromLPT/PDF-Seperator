import { $ } from "./dom.js";

// Render the review grid for the current state.bundles list.
// onChange is called when the user edits a name or toggles skip — useful for any future side effects.
//
// Cards are sorted by review priority — flagged ones (red, then amber) at the
// top, everything else below. The sort is dynamic: when a user approves a
// flagged card or skips one, the card slides down into its natural index
// position among the unflagged cards. Same in reverse if they un-approve.
//
// Reorder works by moving existing DOM nodes (appendChild on already-built
// cards) rather than rebuilding the grid, so input focus, scroll position,
// and partially-typed text are preserved across the move.
export function renderReview(state, onChange = () => {}) {
  const grid = $("grid");
  grid.innerHTML = "";

  const totalPages = state.bundles.reduce((s, b) => s + b.pages.length, 0);
  $("review-meta").textContent =
    `${state.bundles.length} Bundles · ${totalPages} Pages Total · Click Any Name to Edit`;

  // Pairs are populated below; reorder/wrappedOnChange close over the outer
  // `cardPairs` ref so they see the fully-built array when first invoked.
  let cardPairs = [];

  const reorder = () => {
    const sorted = [...cardPairs].sort((a, b) => byReviewPriority(a.bundle, b.bundle));

    // Short-circuit when DOM order already matches the desired order. Calling
    // appendChild on an already-attached node detaches and re-inserts it,
    // which kills focus on any input the user is currently typing into. We
    // only want to actually move nodes when something has truly changed.
    const children = grid.children;
    let inSync = children.length === sorted.length;
    if (inSync) {
      for (let i = 0; i < sorted.length; i++) {
        if (children[i] !== sorted[i].card) { inSync = false; break; }
      }
    }
    if (inSync) return;

    for (const { card } of sorted) grid.appendChild(card);
  };

  const updateCounter = () => updateNeedsCount(state.bundles);
  const wrappedOnChange = (b) => {
    onChange(b);
    updateCounter();
    reorder();
  };

  cardPairs = state.bundles.map((b) => ({
    bundle: b,
    card: buildCard(b, state.prefix, wrappedOnChange),
  }));

  reorder();
  updateCounter();
}

// Sort priority for the review grid:
//   0 — needs review, no auto-detected address (red, "ADDRESS REQUIRED")
//   1 — needs review, weak/loose match (amber, "verify — unfamiliar suffix")
//   2 — auto-detected (strong) but pending the user's approval click
//   3 — done: approved or skipped
// Within each bucket, original packet order (bundle.index) is preserved.
function byReviewPriority(a, b) {
  const ka = reviewBucket(a);
  const kb = reviewBucket(b);
  if (ka !== kb) return ka - kb;
  return a.index - b.index;
}
function reviewBucket(b) {
  if (b.skipped || b.reviewConfirmed) return 3;
  if (b.addressConfidence === "none") return 0;
  if (b.addressConfidence === "weak") return 1;
  return 2;
}

// Two related but distinct flags:
//   needsReview   — auto-detection failed or was weak (red/amber border)
//   needsApproval — user hasn't clicked Approve yet (regardless of detection)
//
// Every non-skipped bundle requires explicit approval before it ships in the
// ZIP. This forces eyes onto every card and prevents the "system says strong,
// user trusts it, false-positive ships" failure mode. needsReview stays
// narrower because only flagged cards get the warning styling.
export function needsReview(b) {
  return !b.skipped && !b.addressDetected && !b.reviewConfirmed;
}
export function needsApproval(b) {
  return !b.skipped && !b.reviewConfirmed;
}

export function countNeedsReview(bundles) {
  return bundles.filter(needsReview).length;
}
export function countNeedsApproval(bundles) {
  return bundles.filter(needsApproval).length;
}

function updateNeedsCount(bundles) {
  const pendingEl = $("pending-approval-count");
  const reviewEl = $("review-needs-count");

  // Union vs subset: the pending banner counts every non-skipped,
  // unapproved bundle (including the flagged ones — a flagged bundle is
  // also "pending approval"). The review banner is the flagged subset.
  // Card classes stay mutually exclusive so a flagged card shows orange,
  // not yellow, but the headline number is the total to-do count.
  const pending = countNeedsApproval(bundles);
  const flagged = countNeedsReview(bundles);

  if (pendingEl) {
    pendingEl.hidden = pending === 0;
    pendingEl.textContent =
      pending === 1 ? "1 Bundle Pending Approval" : `${pending} Bundles Pending Approval`;
  }

  if (reviewEl) {
    reviewEl.hidden = flagged === 0;
    reviewEl.textContent =
      flagged === 1
        ? "1 Bundle Needs Critical Review"
        : `${flagged} Bundles Need Critical Review`;
  }
}

function buildCard(bundle, prefix, onChange) {
  const classes = ["card"];
  if (bundle.skipped) classes.push("skipped");
  if (needsReview(bundle)) classes.push("needs-review");
  const card = el("div", classes.join(" "));

  const badges = el("div", "badges");
  const idx = el("span", "badge idx", "#" + String(bundle.index + 1).padStart(2, "0"));
  const pg = el("span", "badge", `${bundle.pages.length} Pg`);
  badges.append(idx, pg);
  if (bundle.checkNumber) {
    badges.append(el("span", "badge check", `Check# ${bundle.checkNumber}`));
  }
  // Source badge: shows when the address came from the pasted spreadsheet
  // rather than OCR. Fuzzy matches get an extra "~" hint so reviewers know
  // it's a near-miss rather than an exact hit.
  if (bundle.addressSource === "spreadsheet") {
    badges.append(el("span", "badge sheet", "From Spreadsheet"));
  } else if (bundle.addressSource === "spreadsheet-fuzzy") {
    const tag = el("span", "badge sheet fuzzy", "Spreadsheet ~Match");
    const m = bundle.addressLookupMatch;
    if (m && m.matchedCheck) {
      tag.title = `Fuzzy-matched spreadsheet row for check# ${m.matchedCheck}`;
    }
    badges.append(tag);
  }
  card.appendChild(badges);

  // Thumb structure:
  //   .thumb-wrap        — wraps the scrollable viewport
  //     .thumb-viewport  — overflow:auto, scrollbars appear once zoomed in
  //       .thumb-scale   — width grows with zoom level; img + highlights live here
  //         img.thumb
  //         .highlight*
  //
  // Zoom controls live in their own row above the preview (not pinned over
  // it) so they never obscure address/check# text that sits in the page's
  // top-right corner.
  const thumbWrap = el("div", "thumb-wrap");
  const thumbViewport = el("div", "thumb-viewport");
  const thumbScale = el("div", "thumb-scale");
  const img = document.createElement("img");
  img.className = "thumb";
  img.alt = `Front page of bundle ${bundle.index + 1}`;
  img.src = bundle.thumbnail;
  thumbScale.appendChild(img);
  // Highlighter overlay marks on the thumbnail showing where the auto-detected
  // check# and address came from on the page. DOM-only — never reaches the
  // exported PDF in the ZIP. Marks live inside .thumb-scale so their
  // percent-based positioning scales with the image when zoomed.
  for (const mark of buildHighlightMarks(bundle.highlights)) {
    thumbScale.appendChild(mark);
  }
  thumbViewport.appendChild(thumbScale);
  thumbWrap.appendChild(thumbViewport);

  // Split-view sibling: at the top of the zoom ladder we hide the single
  // viewport and reveal two stacked panes, one per highlight, each scaled
  // much harder than the single view could be. Lazy: createSplitView
  // returns null when there's only one (or zero) highlights to split.
  const splitView = createSplitView(bundle.thumbnail, bundle.highlights, img.alt);
  if (splitView) thumbWrap.appendChild(splitView.root);

  // HIDDEN — previous "click thumb to open modal lightbox" UI. Kept commented
  // (not deleted) so we can revert to it if the inline zoom doesn't pan out.
  // The openLightbox / closeLightbox / ensureLightbox helpers below remain
  // wired up and ready; only the trigger here is disabled.
  // const zoomIcon = el("div", "zoom-icon");
  // zoomIcon.innerHTML =
  //   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
  //   '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>';
  // thumbWrap.appendChild(zoomIcon);
  // thumbWrap.addEventListener("click", () =>
  //   openLightbox(bundle.thumbnail, img.alt, bundle.highlights),
  // );

  // Inline per-card zoom: a + / − pair sitting in its own row above the
  // preview. Each press recenters the viewport on the highlighted region so
  // the user can read the address / check# without leaving the grid.
  const zoomControls = el("div", "zoom-controls");
  const zoomInBtn = makeZoomBtn("in", "Zoom in on preview");
  const zoomOutBtn = makeZoomBtn("out", "Zoom out on preview");
  zoomControls.append(zoomOutBtn, zoomInBtn);

  // Per-card zoom stops. Middle stops are numeric (single-viewport zoom
  // levels). The very top stop is the SPLIT_STOP sentinel — when both
  // highlights exist we append it so the final click swaps to side-by-side
  // panes (one per highlight) at a much harder per-pane zoom. The numeric
  // stop just below SPLIT_STOP is the "fit both highlights" level computed
  // by fittingZoom so the lead-in still keeps both visible.
  const zoomLevels = zoomLevelsFor(bundle.highlights, !!splitView);
  let zoomIdx = 0;
  const applyZoom = () => {
    const stop = zoomLevels[zoomIdx];
    const splitting = stop === SPLIT_STOP;
    thumbViewport.style.display = splitting ? "none" : "";
    if (splitView) splitView.root.style.display = splitting ? "flex" : "none";
    zoomOutBtn.disabled = zoomIdx === 0;
    zoomInBtn.disabled = zoomIdx === zoomLevels.length - 1;
    if (splitting) {
      splitView.apply();
      return;
    }
    thumbScale.style.width = `${stop * 100}%`;
    // Wait one frame so the new width is reflected in scroll metrics before
    // we read scrollWidth / scrollHeight to compute the scroll target.
    requestAnimationFrame(() => {
      const focus = highlightFocusPoint(bundle.highlights);
      const sw = thumbViewport.scrollWidth;
      const sh = thumbViewport.scrollHeight;
      const vw = thumbViewport.clientWidth;
      const vh = thumbViewport.clientHeight;
      thumbViewport.scrollLeft = Math.max(0, (focus.x / 100) * sw - vw / 2);
      thumbViewport.scrollTop = Math.max(0, (focus.y / 100) * sh - vh / 2);
    });
  };
  zoomInBtn.addEventListener("click", () => {
    if (zoomIdx < zoomLevels.length - 1) {
      zoomIdx += 1;
      applyZoom();
    }
  });
  zoomOutBtn.addEventListener("click", () => {
    if (zoomIdx > 0) {
      zoomIdx -= 1;
      applyZoom();
    }
  });
  applyZoom();

  // Tuck the zoom toolbar onto the right end of the badges row so it shares
  // a line with the index / page-count / check# badges instead of taking up
  // its own row.
  badges.appendChild(zoomControls);
  card.appendChild(thumbWrap);

  const fn = el("div", "filename");
  const lockL = el("span", "lock", prefix);
  const input = document.createElement("input");
  input.type = "text";
  input.value = bundle.nameBody || "";
  input.placeholder = "check# address";
  input.spellcheck = false;
  input.addEventListener("input", () => {
    bundle.nameBody = input.value;
    onChange(bundle);
  });
  const lockR = el("span", "lock right", ".pdf");
  fn.append(lockL, input, lockR);
  card.appendChild(fn);

  const status = el("div", "status");
  const pill = el("span", "pill");
  status.appendChild(pill);

  const actions = el("div", "card-actions");

  const skipBtn = document.createElement("button");
  skipBtn.className = "skip-btn";
  skipBtn.addEventListener("click", () => {
    bundle.skipped = !bundle.skipped;
    applyReviewState();
    onChange(bundle);
  });
  actions.appendChild(skipBtn);

  // Approve button: every non-skipped bundle requires an explicit approval
  // click before it ships, including auto-detected ones. Clicking flips
  // reviewConfirmed so the card drops out of the pending-approval pool and
  // (if it was flagged) the needs-review pool too. Lives in the bottom-right
  // of the card so it's the last thing the user's eye lands on.
  let confirmBtn = null;
  if (!bundle.skipped) {
    confirmBtn = document.createElement("button");
    confirmBtn.className = "confirm-btn";
    confirmBtn.addEventListener("click", () => {
      bundle.reviewConfirmed = !bundle.reviewConfirmed;
      applyReviewState();
      onChange(bundle);
    });
    actions.appendChild(confirmBtn);
  }

  status.appendChild(actions);
  card.appendChild(status);

  // Reflects bundle state across pill, confirm button, skip button, and the
  // card's review/skip CSS classes. Called once at build and again on every
  // confirm/skip toggle so the same logic owns initial render and updates.
  function applyReviewState() {
    const flagged = needsReview(bundle);
    const noMatch = bundle.addressConfidence === "none";
    // Yellow tier: auto-detected but still awaiting the user's Approve
    // click. Mutually exclusive with `flagged` — a card is either pending
    // (yellow), flagged (amber/red), or done (no class).
    const pending = !flagged && needsApproval(bundle);

    card.classList.toggle("skipped", bundle.skipped);
    card.classList.toggle("needs-review", flagged);
    card.classList.toggle("pending-approval", pending);
    // Red modifier for the "no plausible address found" tier; the default
    // needs-review styling stays amber for the weak (verify) tier.
    card.classList.toggle("no-match", flagged && noMatch);

    pill.classList.toggle("warn", flagged);
    pill.textContent = pillTextFor(bundle);

    if (confirmBtn) {
      confirmBtn.textContent = bundle.reviewConfirmed ? "✓ Approved" : "✓ Approve";
      confirmBtn.title = bundle.reviewConfirmed
        ? "Click to flag again as needs review"
        : "Mark this bundle as approved";
      confirmBtn.classList.toggle("confirmed", !!bundle.reviewConfirmed);
    }

    skipBtn.textContent = bundle.skipped ? "Restore Bundle" : "Skip Bundle";
  }
  applyReviewState();

  return card;
}

function pillTextFor(bundle) {
  if (bundle.reviewConfirmed) return "Approved";
  // Spreadsheet matches override the default OCR-confidence wording so the
  // reviewer can tell at a glance where the address came from. Fuzzy
  // spreadsheet matches still sit in the weak/amber tier so they get an
  // explicit "verify" prompt.
  if (bundle.addressSource === "spreadsheet") return "Address from Spreadsheet";
  if (bundle.addressSource === "spreadsheet-fuzzy") {
    return "Verify — Fuzzy Spreadsheet Match";
  }
  switch (bundle.addressConfidence) {
    case "strong": return "Address Detected";
    case "weak":   return "Verify — Unfamiliar Suffix";
    default:       return "Needs Review — Enter Address";
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Discrete zoom stops for the per-card inline zoom. Stepped rather than
// continuous because users are reading typed text — they want predictable
// "one click bigger" not fine-grained slider control.
const BASE_ZOOM_LEVELS = [1, 1.5, 2, 3];

// Sentinel used as the top of the zoom ladder when both highlights exist.
// At this stop applyZoom swaps the single viewport out for a split view
// with one pane per highlight, each at its own much-higher zoom level.
const SPLIT_STOP = Symbol("split");

// Pick the zoom stops for a card. The numeric stops grow with the default
// ladder, capped at the "both highlights still visible" fit level. When
// both highlights are present we also append the SPLIT_STOP sentinel as
// the final step, so the user can keep clicking + past the fit-both view
// and drop into a per-highlight split.
function zoomLevelsFor(highlights, splittable) {
  const fit = fittingZoom(highlights);
  const base = fit == null
    ? BASE_ZOOM_LEVELS.slice()
    : (() => {
        // Clamp: never zoom out (< 1×), never zoom past 3× even if the bbox
        // is tiny — at that point the page text is plenty readable already.
        const top = Math.max(1, Math.min(3, fit));
        // Drop intermediate stops that crowd against the new top stop so
        // the ladder doesn't end with a near-duplicate step (e.g. 2 → 2.1).
        const stops = BASE_ZOOM_LEVELS.slice(0, -1).filter((v) => v < top - 0.2);
        stops.push(top);
        return stops;
      })();
  if (splittable) base.push(SPLIT_STOP);
  return base;
}

// Largest zoom level at which both highlights stay inside the viewport.
// Derivation: at zoom L the scaled page is L× the viewport, so the viewport
// sees 100/L percent of the page in each dimension. For a bbox spanning
// bboxW% of the page to fit, L ≤ 100 / bboxW. We pad the bbox so the
// highlights sit a hair inside the corners rather than flush against them.
function fittingZoom(highlights) {
  const a = highlights?.address;
  const c = highlights?.check;
  if (!a || !c) return null;
  const x1 = Math.min(a.x, c.x);
  const y1 = Math.min(a.y, c.y);
  const x2 = Math.max(a.x + a.w, c.x + c.w);
  const y2 = Math.max(a.y + a.h, c.y + c.h);
  const bboxW = x2 - x1;
  const bboxH = y2 - y1;
  if (bboxW <= 0 || bboxH <= 0) return null;
  const pad = 1.08;
  return Math.min(100 / (bboxW * pad), 100 / (bboxH * pad));
}

// Build the split-view sibling DOM: two stacked panes inside a container
// that occupies the same footprint as the single .thumb-viewport. Each
// pane owns its own scaled image and a single highlight overlay marker,
// scrolled so the highlight sits in the center of the pane. Returns null
// when there aren't two distinct highlights to split.
function createSplitView(src, highlights, alt) {
  if (!highlights?.check || !highlights?.address) return null;
  const root = el("div", "thumb-split");
  const panes = [
    { key: "check", label: "Check #", bbox: highlights.check },
    { key: "address", label: "Address", bbox: highlights.address },
  ];
  const applies = [];
  for (const p of panes) {
    const pane = el("div", "thumb-split-pane");
    const label = el("div", "thumb-split-label", p.label);
    const viewport = el("div", "thumb-split-viewport");
    const scale = el("div", "thumb-split-scale");
    const im = document.createElement("img");
    im.className = "thumb";
    im.src = src;
    im.alt = `${alt} — ${p.label}`;
    scale.appendChild(im);
    for (const m of buildHighlightMarks({ [p.key]: p.bbox })) {
      scale.appendChild(m);
    }
    viewport.appendChild(scale);
    pane.append(label, viewport);
    root.appendChild(pane);
    applies.push(() => applyPaneZoom(viewport, scale, p.bbox));
  }
  return { root, apply: () => applies.forEach((fn) => fn()) };
}

// Choose a per-pane zoom such that the highlight fills ~30% of the pane's
// width — enough surrounding context to read multi-line addresses without
// shrinking the actual ink. Clamped to [3×, 8×]: below 3× the split feels
// pointless next to the single fit-both view; above 8× pixelation kills
// legibility on low-DPI scans.
function applyPaneZoom(viewport, scale, bbox) {
  const targetFrac = 0.3;
  const L = Math.max(3, Math.min(8, (100 * targetFrac) / Math.max(bbox.w, 0.1)));
  scale.style.width = `${L * 100}%`;
  requestAnimationFrame(() => {
    const fx = bbox.x + bbox.w / 2;
    const fy = bbox.y + bbox.h / 2;
    const sw = viewport.scrollWidth;
    const sh = viewport.scrollHeight;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    viewport.scrollLeft = Math.max(0, (fx / 100) * sw - vw / 2);
    viewport.scrollTop = Math.max(0, (fy / 100) * sh - vh / 2);
  });
}

function makeZoomBtn(kind, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `zoom-btn zoom-${kind}`;
  btn.title = label;
  btn.setAttribute("aria-label", label);
  // Magnifier icon with a + or − inside the lens.
  const inner = kind === "in" ? '<path d="M11 8v6M8 11h6"/>' : '<path d="M8 11h6"/>';
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="11" cy="11" r="7"/>' + inner + '<path d="M21 21l-4.35-4.35"/></svg>';
  return btn;
}

// Where on the page the zoom should center. Prefer the midpoint of the
// check# and address highlights together (keeps both in view when possible);
// fall back to whichever highlight exists; finally the page center if there
// are no highlights at all (e.g. ADDRESS REQUIRED cards).
function highlightFocusPoint(highlights) {
  if (!highlights) return { x: 50, y: 50 };
  const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const a = highlights.address;
  const c = highlights.check;
  if (a && c) {
    const ca = center(a);
    const cc = center(c);
    return { x: (ca.x + cc.x) / 2, y: (ca.y + cc.y) / 2 };
  }
  if (a) return center(a);
  if (c) return center(c);
  return { x: 50, y: 50 };
}

// Build absolute-positioned overlay <div>s for the highlight bboxes attached
// to a bundle. Each bbox is in page-percent coords (top-left origin) so the
// overlays scale with whatever element they're laid over, without us needing
// to know the rendered pixel size.
function buildHighlightMarks(highlights) {
  const marks = [];
  if (!highlights) return marks;
  for (const key of ["check", "address"]) {
    const b = highlights[key];
    if (!b) continue;
    // Pad slightly so the marker sits a hair outside the glyph bbox — looks
    // more like a real highlighter swipe than a tight rectangle.
    const padX = 0.4;
    const padY = 0.4;
    const m = document.createElement("div");
    m.className = `highlight ${key}`;
    m.style.left = `${Math.max(0, b.x - padX)}%`;
    m.style.top = `${Math.max(0, b.y - padY)}%`;
    m.style.width = `${b.w + padX * 2}%`;
    m.style.height = `${b.h + padY * 2}%`;
    marks.push(m);
  }
  return marks;
}

// Lightbox: lazy-attaches its dismiss listeners (backdrop click + Escape) on
// first open, so we don't pay for them until the user actually zooms a page.
// Overlays mirror the review-card highlights — the lightbox container holds
// a wrapper around the <img> so the absolute-positioned marks land on the
// image rather than the full backdrop.
let lightboxReady = false;
function ensureLightbox() {
  if (lightboxReady) return;
  const lb = $("lightbox");
  if (!lb) return;
  lb.addEventListener("click", () => closeLightbox());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lb.hidden) closeLightbox();
  });
  lightboxReady = true;
}
function openLightbox(src, alt, highlights) {
  ensureLightbox();
  const lb = $("lightbox");
  const wrap = $("lightbox-wrap");
  const img = $("lightbox-img");
  if (!lb || !img || !wrap) return;
  img.src = src;
  img.alt = alt || "";
  // Replace any previous overlays.
  for (const old of wrap.querySelectorAll(".highlight")) old.remove();
  for (const mark of buildHighlightMarks(highlights)) wrap.appendChild(mark);
  lb.hidden = false;
}
function closeLightbox() {
  const lb = $("lightbox");
  const wrap = $("lightbox-wrap");
  const img = $("lightbox-img");
  if (!lb) return;
  lb.hidden = true;
  if (img) img.src = "";
  if (wrap) for (const old of wrap.querySelectorAll(".highlight")) old.remove();
}
