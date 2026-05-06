import { $ } from "./dom.js";

// Render the review grid for the current state.bundles list.
// onChange is called when the user edits a name or toggles skip — useful for any future side effects.
export function renderReview(state, onChange = () => {}) {
  const grid = $("grid");
  grid.innerHTML = "";

  const totalPages = state.bundles.reduce((s, b) => s + b.pages.length, 0);
  $("review-meta").textContent =
    `${state.bundles.length} bundles · ${totalPages} pages total · click any name to edit`;

  for (const b of state.bundles) {
    grid.appendChild(buildCard(b, state.prefix, onChange));
  }
}

function buildCard(bundle, prefix, onChange) {
  const classes = ["card"];
  if (bundle.skipped) classes.push("skipped");
  if (!bundle.addressDetected && !bundle.skipped) classes.push("needs-review");
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
  const pill = el(
    "span",
    "pill" + (bundle.addressDetected ? "" : " warn"),
    bundle.addressDetected ? "address detected" : "needs review — enter address"
  );
  status.appendChild(pill);

  const skipBtn = document.createElement("button");
  skipBtn.className = "subtle";
  skipBtn.textContent = bundle.skipped ? "Restore" : "Skip";
  skipBtn.addEventListener("click", () => {
    bundle.skipped = !bundle.skipped;
    card.classList.toggle("skipped", bundle.skipped);
    skipBtn.textContent = bundle.skipped ? "Restore" : "Skip";
    onChange(bundle);
  });
  status.appendChild(skipBtn);
  card.appendChild(status);

  return card;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
