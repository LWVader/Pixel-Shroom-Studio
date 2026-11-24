import {industries} from "./industries.js";
import {protectedCampaignPreview} from "./campaign-preview.js";

const list = document.querySelector("#publisher-list");
const form = document.querySelector("#portfolio-form");
const preview = document.querySelector("#publisher-image");
const status = document.querySelector("#publisher-status");
const formStatus = document.querySelector("#publisher-form-status");
const more = document.querySelector("#more-campaigns");
const protectExisting = document.querySelector("#protect-existing-previews");
let current, offset = 0;
for (const [id, label] of Object.entries(industries)) {
  form.elements.sector.add(new Option(label, id));
}

async function request(query = "", data) {
  const response = await fetch("/api/admin/portfolio" + query, data ? {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(data)
  } : {});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Campaign publisher is unavailable.");
  return result;
}

function action(label, href, handler) {
  const control = document.createElement(href ? "a" : "button");
  control.className = "secondary";
  control.textContent = label;
  if (href) control.href = href;
  else {
    control.type = "button";
    control.addEventListener("click", handler);
  }
  return control;
}

function edit(item) {
  current = item || {id: crypto.randomUUID(), version: 0};
  form.reset();
  for (const field of ["name", "sector", "tagline", "brief", "value", "alt"]) {
    if (item) form.elements[field].value = item[field];
  }
  form.elements.palette.value = item?.colors.join(", ") || "";
  form.elements.image.required = !item;
  form.querySelector('[value="draft"]').textContent = item?.published ? "Unpublish to draft" : "Save as draft";
  preview.hidden = !item;
  if (item) preview.src = item.imageUrl;
  else preview.removeAttribute("src");
  formStatus.textContent = "";
  form.hidden = false;
  form.elements.name.focus();
}

function row(item) {
  const result = document.createElement("li");
  result.className = "order-row";
  const copy = document.createElement("div");
  const name = document.createElement("strong");
  const label = document.createElement("small");
  name.textContent = item.name;
  const state = item.published ? item.previewReady ? "Live on the site" : "Preview needs protection" : "Draft";
  label.textContent = `${state} · ${industries[item.sector] || industries.other}`;
  copy.append(name, label);
  const controls = document.createElement("div");
  controls.className = "publisher-actions";
  controls.append(action("Edit", null, () => edit(item)));
  if (item.published && item.previewReady) {
    controls.append(action("View live", `/?campaign=${item.id}#work`),
      action("Create ad", `/admin-ad-studio/?campaign=${item.id}`));
  }
  result.append(copy, controls);
  return result;
}

export async function loadPortfolio(reset = true) {
  if (reset) {
    offset = 0;
    protectExisting.hidden = true;
    list.replaceChildren();
  }
  more.disabled = true;
  try {
    const data = await request(`?offset=${offset}`);
    list.append(...data.campaigns.map(row));
    offset += data.campaigns.length;
    more.hidden = !data.more;
    if (data.more || data.campaigns.some(item => !item.previewReady)) protectExisting.hidden = false;
    status.textContent = offset ? "" : "No custom campaigns yet.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    more.disabled = false;
  }
}

async function prepareImage(file) {
  if (!file || file.size === 0) return null;
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose an image under 20 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [.87, .73, .58]) {
      const encoded = canvas.toDataURL("image/webp", quality);
      const prefix = "data:image/webp;base64,";
      if (encoded.startsWith(prefix) && encoded.length <= 1_100_000) return encoded.slice(prefix.length);
    }
    throw new Error("This artwork could not be compressed. Try a smaller JPG, PNG or WebP image.");
  } finally {
    bitmap.close();
  }
}

async function prepareExistingPreview(item) {
  const response = await fetch(item.imageUrl);
  if (!response.ok) throw new Error("The original artwork could not be loaded.");
  const preview = await protectedCampaignPreview(await response.blob());
  await request("", {action: "protect-preview", id: item.id, version: item.version, preview});
}

protectExisting.addEventListener("click", async () => {
  protectExisting.disabled = true;
  let protectedCount = 0, failed = 0, next = 0;
  try {
    do {
      const data = await request(`?offset=${next}`);
      for (const item of data.campaigns.filter(item => !item.previewReady)) {
        status.textContent = `Protecting the preview for ${item.name}…`;
        try {
          await prepareExistingPreview(item);
          protectedCount++;
        } catch (error) {
          failed++;
          console.warn("Campaign preview was not rebuilt", item.id, error.message);
        }
      }
      next = data.more ? next + data.campaigns.length : 0;
    } while (next);
    await loadPortfolio();
    status.textContent = failed
      ? `${protectedCount} updated. ${failed} could not be protected. Retry the remaining previews.`
      : protectedCount ? `Protected previews updated for ${protectedCount} campaign(s).` : "All campaign previews are protected.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    protectExisting.disabled = false;
  }
});

document.querySelector("#new-campaign").addEventListener("click", () => edit());
document.querySelector("#cancel-campaign").addEventListener("click", () => { form.hidden = true; });
more.addEventListener("click", () => loadPortfolio(false));
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!current) return;
  const published = event.submitter.value === "live";
  const controls = [...form.querySelectorAll("button")];
  for (const control of controls) control.disabled = true;
  formStatus.textContent = "Saving campaign…";
  try {
    const fields = Object.fromEntries(new FormData(form));
    const image = await prepareImage(fields.image);
    const preview = image ? await protectedCampaignPreview(fields.image) : null;
    if (!image && !current.previewReady && published) {
      throw new Error("Use Protect existing previews or upload the artwork again before publishing.");
    }
    const saved = await request("", {...fields, id: current.id, version: current.version, image, preview, published});
    form.hidden = true;
    current = null;
    await loadPortfolio();
    status.textContent = saved.published ? "Campaign published to the live portfolio." : "Campaign saved as a draft.";
  } catch (error) {
    formStatus.textContent = error.message;
  } finally {
    for (const control of controls) control.disabled = false;
  }
});
