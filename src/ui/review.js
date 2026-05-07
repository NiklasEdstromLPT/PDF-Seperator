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
  card.appendChild(badges);

  const thumbWrap = el("div", "thumb-wrap");
  const img = document.createElement("img");
  img.className = "thumb";
  img.alt = `Front page of bundle ${bundle.index + 1}`;
  img.src = bundle.thumbnail;
  thumbWrap.appendChild(img);
  // Highlighter overlay marks on the thumbnail showing where the auto-detected
  // check# and address came from on the page. DOM-only — never reaches the
  // exported PDF in the ZIP.
  for (const mark of buildHighlightMarks(bundle.highlights)) {
    thumbWrap.appendChild(mark);
  }
  const zoomIcon = el("div", "zoom-icon");
  zoomIcon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>';
  thumbWrap.appendChild(zoomIcon);
  thumbWrap.addEventListener("click", () =>
    openLightbox(bundle.thumbnail, img.alt, bundle.highlights),
  );
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
