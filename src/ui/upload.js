import { $, toast } from "./dom.js";

// Wire the drop zone, file picker, and settings inputs.
// onFile receives ({ file, prefix }) and is responsible for kicking off the pipeline.
export function initUpload(onFile) {
  const drop = $("drop");
  const fileInput = $("file-input");

  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("hover");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("hover"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("hover");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) accept(f);
  });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) accept(f);
    fileInput.value = "";
  });

  function accept(file) {
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      toast("That doesn't look like a PDF. Please pick a .pdf file.", "bad");
      return;
    }
    const prefix = $("prefix").value || "";
    onFile({ file, prefix });
  }
}
