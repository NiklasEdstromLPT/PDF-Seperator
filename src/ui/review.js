import { $ } from "./dom.js";

// Render the review grid for the current state.bundles list.
// onChange is called when the user edits a name or toggles skip — useful for any future side effects.
export function renderReview(state, onChange = () => {}) {
  const grid = $("grid");
  grid.innerHTML = "";

  const totalPages = state.bundles.reduce((s, b) => s + b.pages.length, 0);
  $("review-meta").textContent =
    `${state.bundles.length} bundles · ${totalPages} pages total · click any name to edit`;

  const updateCounter = () => updateNeedsCount(state.bundles);
  const wrappedOnChange = (b) => { onChange(b); updateCounter(); };

  for (const b of state.bundles) {
    grid.appendChild(buildCard(b, state.prefix, wrappedOnChange));
  }
  updateCounter();
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
    card.classList.toggle("skipped", bundle.skipped);
    card.classList.toggle("needs-review", needsReview(bundle));

    pill.classList.toggle("warn", needsReview(bundle));
    pill.textContent = bundle.addressDetected
      ? "address detected"
      : bundle.reviewConfirmed
        ? "approved"
        : "needs review";

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

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
