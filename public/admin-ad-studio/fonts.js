import {state, requestPreview} from "./app.js";

export const FontLibrary = (() => {
  const system = ["Arial", "Comic Sans MS", "Verdana", "Georgia", "Times New Roman", "Courier New", "Trebuchet MS", "Tahoma"];
  const known = new Set(system);
  const loaded = new Map(system.map(family => [family, "system"]));
  const pending = new Map();
  let catalog = [];
  let generation = 0;
  const get = id => document.getElementById(id);

  function options() {
    const select = get("captionFont");
    const query = get("fontSearch").value.toLowerCase();
    const current = typeof state === "undefined" ? "Arial" : state.captionFont;
    const list = [...system.map(family => ({family, category: "System"})), ...catalog]
      .filter(({family}) => family.toLowerCase().includes(query) || family === current);
    select.replaceChildren(...list.map(({family, category}) => new Option(family + " · " + category, family)));
    select.value = current;
    get("fontCount").textContent = list.length.toLocaleString() + " matching fonts";
  }

  async function stylesheet(family, weights) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(family) + ":wght@" + weights.join(";") + "&display=swap";
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error()), 8000);
        link.onload = () => { clearTimeout(timer); resolve(); };
        link.onerror = () => { clearTimeout(timer); reject(Error()); };
        document.head.append(link);
      });
      const faces = await Promise.all(weights.map(weight => document.fonts.load(weight + ' 28px "' + family + '"')));
      if (faces.some(group => !group.length)) throw Error();
      return true;
    } catch {
      link.remove();
      return false;
    }
  }

  async function load(family) {
    if (loaded.has(family)) return loaded.get(family);
    if (pending.has(family)) return pending.get(family);
    if (!known.has(family)) return "";
    const task = (async () => {
      const result = await stylesheet(family, [400, 700]) ? "both" : await stylesheet(family, [400]) ? "regular" : "";
      if (result) {
        loaded.set(family, result);
        generation++;
      }
      pending.delete(family);
      return result;
    })();
    pending.set(family, task);
    return task;
  }

  function sync(s, palette) {
    const family = s.captionFont || "Arial";
    get("captionFont").value = family;
    get("chosenFontLabel").textContent = family;
    const preview = get("bottomCopyPreview");
    preview.style.fontFamily = '"' + family + '", sans-serif';
    preview.style.color = palette.ink;
    preview.style.background = palette.post;
    get("captionCopyPreview").textContent = s.headline;
    get("captionCopyPreview").style.fontWeight = weight(family, s.captionWeight);
    get("captionCopyPreview").style.textAlign = s.captionAlign;
    const button = get("buttonCopyPreview");
    button.textContent = s.cta;
    button.style.color = palette.buttonInk;
    button.style.background = palette.button;
    get("websiteCopyPreview").textContent = s.website;
    get("headline").style.fontFamily = preview.style.fontFamily;
    get("fontStatus").textContent = loaded.has(family) ? "Font ready for preview and export." : "Loading " + family + "…";
    const wasLoaded = loaded.has(family);
    load(family).then(result => {
      if (state.captionFont !== family) return;
      get("fontStatus").textContent = result === "regular" ? "This family uses regular weight in the ad." :
        result ? "Font ready for preview and export." : "Font could not load. Choose a system font before export.";
      if (!wasLoaded && result) {
        get("captionCopyPreview").style.fontWeight = weight(family, s.captionWeight);
        requestPreview();
      }
    });
  }

  const weight = (family, value) => loaded.get(family) === "regular" ? "400" : value;
  get("captionFont").addEventListener("change", () => { get("fontPicker").open = false; });
  get("fontSearch").oninput = options;
  const catalogReady = fetch("font-catalog.json").then(response => {
    if (!response.ok) throw Error();
    return response.json();
  }).then(data => {
    catalog = data;
    for (const {family} of data) known.add(family);
    options();
  }).catch(() => {
    options();
    get("fontStatus").textContent = "Font catalog unavailable. System fonts still work.";
  });
  return {sync, load, weight, catalogReady, ready: family => loaded.has(family), valid: family => known.has(family),
    get generation() { return generation; }};
})();
