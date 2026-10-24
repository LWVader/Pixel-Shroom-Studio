import {
  inspectPrintBytes,
  evaluatePrint,
  normalizeSpecs,
  SIZE_PRESETS,
} from "./print-preflight-core.js?v=20261024-one-upload";
import { escapeHtml } from "./catalog-core.js?v=20261022-loop";
export function createPrintPreflight(form, loadStoredFacts) {
  const result = document.querySelector("#gelato-preflight-result"),
    button = document.querySelector("#gelato-safe-check"),
    image = document.querySelector("#gelato-check-image"),
    preview = document.querySelector("#gelato-file-preview"),
    overlay = document.querySelector("#gelato-safe-overlay"),
    zoom = document.querySelector("#gelato-preview-zoom");
  let revision = 0,
    report = null,
    facts = null,
    cachedFile = null,
    objectUrl = "";
  const specs = () =>
    normalizeSpecs(
      Object.fromEntries(
        [
          "width",
          "height",
          "bleedMm",
          "wrapMm",
          "safeMm",
          "minimumDpi",
          "templateUrl",
          "transparent",
        ].map((key) => [
          key,
          form.elements[key].type === "checkbox"
            ? form.elements[key].checked
            : form.elements[key].value,
        ]),
      ),
    );
  function invalidate() {
    overlay.hidden = true;
    revision++;
    report = null;
    result.dataset.state = "stale";
    result.textContent =
      "Not checked. Check the image after changing the source or product settings.";
  }
  const affectsCheck = (target) =>
    [
      "printFile",
      "product_uid",
      "kind",
      "variant_label",
      "width",
      "height",
      "bleedMm",
      "wrapMm",
      "safeMm",
      "minimumDpi",
      "templateUrl",
      "transparent",
    ].includes(target.name);
  form.addEventListener("input", (event) => {
    if (affectsCheck(event.target)) invalidate();
  });
  form.addEventListener("change", (event) => {
    if (event.target.name === "printFile") {
      facts = null;
      cachedFile = null;
      preview.hidden = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
    if (affectsCheck(event.target)) invalidate();
  });
  document.querySelector("#gelato-size-preset").onchange = (event) => {
    const size = SIZE_PRESETS[event.target.value];
    if (size) {
      form.elements.width.value = size[0];
      form.elements.height.value = size[1];
    }
    invalidate(true);
  };
  function drawGuide() {
    if (!report || preview.hidden) return;
    overlay.hidden = false;
    const s = report.specs;
    const x = (s.bleedMm + s.wrapMm + s.safeMm) / (report.widthIn * 25.4);
    const y = (s.bleedMm + s.wrapMm + s.safeMm) / (report.heightIn * 25.4);
    const w = image.getBoundingClientRect().width,
      h = image.getBoundingClientRect().height;
    overlay.style.cssText = `left:${w * x}px;top:${h * y}px;width:${w * (1 - 2 * x)}px;height:${h * (1 - 2 * y)}px`;
  }
  zoom.onchange = () => {
    image.style.width =
      zoom.value === "fit" ? "100%" : `${image.naturalWidth * Number(zoom.value)}px`;
    drawGuide();
  };
  new ResizeObserver(drawGuide).observe(preview);
  button.onclick = async () => {
    const ticket = revision;
    button.disabled = true;
    result.textContent = "Reading file and checking product fit…";
    try {
      const input = specs(),
        file = form.elements.printFile.files[0];
      if (file && file !== cachedFile) {
        if (file.size > 104857600) throw Error("File exceeds 100 MB.");
        const buffer = await file.arrayBuffer();
        const inspected = inspectPrintBytes(buffer);
        const digest = await crypto.subtle.digest("SHA-256", buffer);
        inspected.sha256 = [...new Uint8Array(digest)]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        if (inspected.format !== "pdf") {
          const url = URL.createObjectURL(file);
          try {
            const decoded = new Image();
            decoded.src = url;
            await decoded.decode();
            if (
              decoded.naturalWidth !== inspected.width ||
              decoded.naturalHeight !== inspected.height
            )
              throw Error(
                "Image orientation/decoded size differs from its header. Export a flattened, correctly oriented print file.",
              );
            if (ticket !== revision) throw Error("Selection changed; run Safe check again.");
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            objectUrl = url;
            image.src = url;
            await image.decode();
            preview.hidden = false;
          } catch (error) {
            if (objectUrl !== url) URL.revokeObjectURL(url);
            throw error;
          }
        } else preview.hidden = true;
        facts = inspected;
        cachedFile = file;
      } else if (!file && !facts) {
        facts = await loadStoredFacts();
        preview.hidden = true;
      }
      if (!facts) throw Error("Choose a dedicated print artwork file first.");
      if (ticket !== revision) throw Error("Selection changed; run Safe check again.");
      report = evaluatePrint(facts, input);
      result.dataset.state = report.state;
      result.innerHTML = `<p><strong>${report.state === "ready" ? "Technical checks passed" : "Cannot publish — fix the following"}</strong></p>
        <p>${escapeHtml(facts.format.toUpperCase())} · ${(facts.bytes / 1048576).toFixed(2)} MB${facts.format !== "pdf" ? ` · ${facts.width} × ${facts.height} px · ${report.dpi.toFixed(1)} effective PPI` : " · PDF technical properties require external preflight"}</p>
        <p>Minimum: ${report.minimum.join(" × ")} px. Recommended at 300 PPI: ${report.target.join(" × ")} px, including the entered bleed/wrap.</p>
        <p>Profile: ${escapeHtml(facts.profile)}. SHA-256: ${escapeHtml(facts.sha256)}</p>
        ${[...report.errors, ...report.warnings].map((text) => `<p>${escapeHtml(text)}</p>`).join("")}
        <p>${escapeHtml(report.assurance)}</p>`;
      drawGuide();
    } catch (error) {
      report = null;
      result.dataset.state = "blocked";
      result.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  return {
    check: () => button.onclick(),
    useStoredSource(sourceFacts, url) {
      invalidate();
      facts = sourceFacts;
      cachedFile = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = "";
      image.src = url;
      image.style.width = "100%";
      preview.hidden = false;
    },
    reset(savedSpecs) {
      invalidate();
      facts = null;
      cachedFile = null;
      preview.hidden = true;
      zoom.value = "fit";
      image.style.width = "100%";
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = "";
      image.removeAttribute("src");
      if (savedSpecs)
        for (const [key, value] of Object.entries(savedSpecs)) {
          const el = form.elements[key];
          if (!el) continue;
          if (el.type === "checkbox") el.checked = value === true;
          else el.value = value;
        }
    },
    submission(active) {
      if (!report || !facts) throw Error("Check this image and product before publishing.");
      if (active && report.state !== "ready")
        throw Error("Cannot publish: fix the listed technical issues first.");
      return { preflight_hash: facts.sha256, print_specs: specs() };
    },
  };
}
