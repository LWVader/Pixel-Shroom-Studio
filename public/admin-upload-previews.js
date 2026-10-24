// These thumbnails stay in the signed-in owner's browser; they do not upload files.
const form = document.querySelector("#art-form");
const urls = new Map();
function clear(input) {
  if (urls.has(input.name)) URL.revokeObjectURL(urls.get(input.name));
  urls.delete(input.name);
  const preview = form.querySelector(`[data-image-for="${input.name}"]`);
  preview.hidden = true;
  preview.removeAttribute("src");
}
for (const input of form.querySelectorAll('input[type="file"][accept*="image/"]')) {
  input.addEventListener("change", () => {
    clear(input);
    const file = input.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    urls.set(input.name, url);
    const preview = form.querySelector(`[data-image-for="${input.name}"]`);
    preview.src = url;
    preview.hidden = false;
  });
}
form.addEventListener("reset", () => {
  for (const input of form.querySelectorAll('input[type="file"][accept*="image/"]')) clear(input);
});
