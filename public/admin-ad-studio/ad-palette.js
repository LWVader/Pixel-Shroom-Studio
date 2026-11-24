"use strict";

export const AdPalette = (() => {
  const presets = Object.freeze({
    "studio-neon": {name: "Studio Neon", colors: ["#100E15", "#21162F", "#8C4DE8", "#D9FF55", "#F8F4FF"]},
    "warm-print": {name: "Warm Print", colors: ["#261617", "#542A27", "#B64D34", "#FEB04A", "#FFF3DC"]},
    "midnight-coast": {name: "Midnight Coast", colors: ["#0B1927", "#142C42", "#456EA2", "#69EDD9", "#EBFAFF"]},
    "botanical": {name: "Botanical", colors: ["#142219", "#283D2C", "#708D55", "#F1CC78", "#F8F4E5"]}
  });
  const defaultPalette = Object.freeze(presets["studio-neon"].colors);

  function normalize(value) {
    const parts = Array.isArray(value) ? value : typeof value === "string"
      ? value.trim().split(/[\s,;]+/).filter(Boolean) : [];
    if (!parts.length || parts.length > 5) return null;
    const colors = [];
    for (const part of parts) {
      if (typeof part !== "string" || !/^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(part)) return null;
      const hex = part.replace(/^#/, "").toUpperCase();
      colors.push("#" + (hex.length === 3 ? [...hex].map((digit) => digit.repeat(2)).join("") : hex));
    }
    return [...new Set(colors)];
  }

  function channels(hex) {
    return [1, 3, 5].map((position) => parseInt(hex.slice(position, position + 2), 16));
  }

  function describe(hex) {
    const rgb = channels(hex);
    const linear = rgb.map((value) => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return {
      hex, light: linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722,
      chroma: Math.max(...rgb) - Math.min(...rgb)
    };
  }

  function contrast(a, b) {
    return (Math.max(a.light, b.light) + .05) / (Math.min(a.light, b.light) + .05);
  }

  function strongest(background, options) {
    return options.reduce((best, current) => contrast(background, current) > contrast(background, best) ? current : best);
  }

  const neutrals = [describe("#000000"), describe("#FFFFFF")];

  function inkFor(background, colors) {
    const preferred = strongest(background, colors);
    return (contrast(background, preferred) >= 4.5 ? preferred : strongest(background, neutrals)).hex;
  }

  function blend(a, b, amount) {
    const second = channels(b);
    return "#" + channels(a).map((v, i) => Math.round(v + (second[i] - v) * amount).toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  function roles(palette) {
    const supplied = palette.map(describe);
    // Short palettes still need surfaces and readable type. Keep the supplied hues available for the accent.
    const [canvas, post] = supplied.length < 3
      ? [describe("#100E15"), describe("#21162F")]
      : [...supplied].sort((a, b) => a.light - b.light);
    const accents = supplied.filter((color) => color.hex !== canvas.hex && color.hex !== post.hex)
      .sort((a, b) => b.chroma - a.chroma || contrast(post, b) - contrast(post, a));
    const candidates = accents.length ? accents : supplied;
    const button = candidates.find((color) => contrast(post, color) >= 3) || strongest(post, neutrals);
    const sceneAccent = candidates.find((color) => color !== button && color.chroma > 0) || candidates[0];
    return {
      canvas: canvas.hex, post: post.hex, ink: inkFor(post, supplied), button: button.hex,
      buttonInk: inkFor(button, supplied), scene: blend(post.hex, sceneAccent.hex, .64),
      outline: blend(post.hex, inkFor(post, supplied), .20)
    };
  }

  function fromLegacy(project) {
    const marketing = project.layout === "marketing";
    const fields = marketing
      ? ["marketingCanvasColor", "marketingPostColor", "marketingTextColor"]
      : ["outerColor", "cardColor", "textColor"];
    if (project.bgMode === "color") fields.push("bgColor");
    fields.push("accent");
    const valid = fields.flatMap((key) => normalize([project[key]]) || []);
    return normalize(valid);
  }

  function editor(onApply) {
    const select = document.querySelector("#palette-choice");
    const custom = document.querySelector("#custom-palette");
    const input = document.querySelector("#palette-input");
    const nameInput = document.querySelector("#palette-name");
    const message = document.querySelector("#palette-message");
    const swatches = document.querySelector("#palette-swatches");
    const storageKey = "pss-ad-studio-palettes";
    function readSaved() {
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
        if (Array.isArray(stored)) {
          return stored.flatMap((entry) => {
            const {name, colors} = entry || {};
            const palette = normalize(colors);
            return typeof name === "string" && name.trim() && palette ? [{name, colors: palette}] : [];
          });
        }
      } catch { /* A blocked or invalid store still allows palettes per ad. */ }
      return [];
    }
    const saved = readSaved();

    const savedId = (name) => "saved:" + name;
    const appendSaved = ({name}) => select.add(new Option(name, savedId(name)), select.options.length - 1);
    for (const [id, preset] of Object.entries(presets)) select.add(new Option(preset.name, id));
    select.add(new Option("Custom palette", "custom"));
    saved.forEach(appendSaved);
    let appliedColors, appliedName;

    select.addEventListener("change", () => {
      message.textContent = "";
      custom.hidden = select.value !== "custom";
      if (!custom.hidden) {
        input.value = appliedColors.join(", ");
        nameInput.value = "";
        input.focus();
        return;
      }
      const preset = presets[select.value];
      const stored = saved.find((entry) => savedId(entry.name) === select.value);
      onApply((preset || stored).colors, stored?.name || "");
    });
    input.addEventListener("input", () => {
      input.removeAttribute("aria-invalid");
      message.textContent = "";
    });

    function apply(save) {
      const colors = normalize(input.value);
      if (!colors) {
        input.setAttribute("aria-invalid", "true");
        message.textContent = "Enter one to five valid hex colors.";
        input.focus();
        return;
      }
      const name = nameInput.value.trim();
      if (save) {
        if (!name) {
          message.textContent = "Name the palette to save it to Studio.";
          nameInput.focus();
          return;
        }
        for (const entry of readSaved()) {
          if (saved.some((current) => current.name === entry.name)) continue;
          saved.push(entry);
          appendSaved(entry);
        }
        if ([...Object.values(presets), ...saved].some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
          message.textContent = "That palette name is already in use.";
          nameInput.focus();
          return;
        }
        const entry = {name, colors};
        try {
          localStorage.setItem(storageKey, JSON.stringify([...saved, entry]));
        } catch {
          onApply(colors, "");
          message.textContent = "Applied to this ad. Studio could not save the palette in this browser.";
          return;
        }
        saved.push(entry);
        appendSaved(entry);
      }
      onApply(colors, save ? name : "");
      if (save) select.focus();
      else nameInput.value = name;
      message.textContent = save ? name + " saved to Studio and applied." : "Palette applied to this ad.";
    }

    document.querySelector("#apply-palette").onclick = () => apply(false);
    document.querySelector("#save-palette").onclick = () => apply(true);

    return (colors, name, theme) => {
      if (appliedColors === colors && appliedName === name) return;
      appliedColors = colors;
      appliedName = name;
      const sameColors = (entry) => entry.colors.join() === colors.join();
      const stored = saved.find((entry) => entry.name === name && sameColors(entry));
      const preset = !name && Object.entries(presets).find(([, entry]) => sameColors(entry));
      select.value = stored ? savedId(stored.name) : preset ? preset[0] : "custom";
      custom.hidden = select.value !== "custom";
      input.value = colors.join(", ");
      nameInput.value = name;
      input.removeAttribute("aria-invalid");
      message.textContent = "";
      swatches.replaceChildren(...Object.entries({
        Canvas: theme.canvas, Post: theme.post, Artwork: theme.scene, Text: theme.ink,
        Button: theme.button, "Button text": theme.buttonInk
      }).map(([label, hex]) => {
        const item = document.createElement("li");
        const chip = document.createElement("span");
        chip.style.backgroundColor = hex;
        chip.setAttribute("aria-hidden", "true");
        const caption = document.createElement("span");
        caption.textContent = label;
        const code = document.createElement("code");
        code.textContent = hex;
        item.append(chip, caption, code);
        return item;
      }));
    };
  }

  return {defaultPalette, normalize, roles, fromLegacy, editor};
})();
