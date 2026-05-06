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
    `${state.bundles.length} bundles · ${totalPages} pages total · click any name to edit`;

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
//   2 — everything else: strong-detected, approved, or skipped
// Within each bucket, original packet order (bundle.index) is preserved.
function byReviewPriority(a, b) {
  const ka = reviewBucket(a);
  const kb = reviewBucket(b);
  if (ka !== kb) return ka - kb;
  return a.index - b.index;
}
function reviewBucket(b) {
  if (!needsReview(b)) return 2;
  return b.addressConfidence === "none" ? 0 : 1;
}

// Whether a bundle is still flagged for human review.
// A bundle escapes review when it had an auto-detected address, was manually
// confirmed via the checkmark, or was skipped (excluded from output).
export function needsReview(b) {
  return !b.skipped && !b.addressDetected && !b.reviewConfirmed;
}

export function countNeedsReview(bundles) {
  return bundles.filter(needsReview).length;
}

function updateNeedsCount(bundles) {
  const el = $("review-needs-count");
  if (!el) return;
  const n = countNeedsReview(bundles);
  el.hidden = n === 0;
  if (n === 0) return;
  el.textContent = n === 1 ? "1 Bundle needs review" : `${n} bundles need review`;
}

function buildCard(bundle, prefix, onChange) {
  const classes = ["card"];
  if (bundle.skipped) classes.push("skipped");
  if (needsReview(bundle)) classes.push("needs-review");
  const card = el("div", classes.join(" "));

  const badges = el("div", "badges");
  const idx = el("span", "badge idx", "#" + String(bundle.index + 1).padStart(2, "0"));
  const pg = el("span", "badge", `${bundle.pages.length} pg`);
  badges.append(idx, pg);
  if (bundle.checkNumber) {
    badges.append(el("span", "badge check", `check ${bundle.checkNumber}`));
  }
  card.appendChild(badges);

  const img = document.createElement("img");
  img.className = "thumb";
  img.alt = `Front page of bundle ${bundle.index + 1}`;
  img.src = bundle.thumbnail;
  card.appendChild(img);

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

  // Manual-confirm button: only meaningful when the bundle wasn't auto-detected
  // and isn't skipped. Clicking it flips reviewConfirmed so the card leaves the
  // needs-review pool (and the top-of-screen counter ticks down).
  let confirmBtn = null;
  if (!bundle.addressDetected && !bundle.skipped) {
    confirmBtn = document.createElement("button");
    confirmBtn.className = "confirm-btn";
    confirmBtn.addEventListener("click", () => {
      bundle.reviewConfirmed = !bundle.reviewConfirmed;
      applyReviewState();
      onChange(bundle);
    });
    badges.appendChild(confirmBtn);
  }

  const skipBtn = document.createElement("button");
  skipBtn.className = "subtle";
  skipBtn.addEventListener("click", () => {
    bundle.skipped = !bundle.skipped;
    applyReviewState();
    onChange(bundle);
  });
  status.appendChild(skipBtn);
  card.appendChild(status);

  // Reflects bundle state across pill, confirm button, skip button, and the
  // card's review/skip CSS classes. Called once at build and again on every
  // confirm/skip toggle so the same logic owns initial render and updates.
  function applyReviewState() {
    const flagged = needsReview(bundle);
    const noMatch = bundle.addressConfidence === "none";

    card.classList.toggle("skipped", bundle.skipped);
    card.classList.toggle("needs-review", flagged);
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

    skipBtn.textContent = bundle.skipped ? "Restore" : "Skip";
  }
  applyReviewState();

  return card;
}

function pillTextFor(bundle) {
  if (bundle.reviewConfirmed) return "approved";
  switch (bundle.addressConfidence) {
    case "strong": return "address detected";
    case "weak":   return "verify — unfamiliar suffix";
    default:       return "needs review — enter address";
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
