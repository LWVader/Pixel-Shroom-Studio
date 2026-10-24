import {
  positionGeometry,
  fullPrintArea,
  positionedResolution,
} from "./print-position-core.js?v=20261024-editor";
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const canvasBlob = (canvas, type = "image/png", quality) =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(Error("Cannot export this image."))),
      type,
      quality,
    ),
  );
export function createPrintPositioner(form, changed, productSpecs) {
  const canvas = document.querySelector("#gelato-position-canvas");
  const ctx = canvas.getContext("2d");
  const zoom = document.querySelector("#gelato-position-zoom");
  const xControl = document.querySelector("#gelato-position-x");
  const yControl = document.querySelector("#gelato-position-y");
  const modal = document.querySelector("#gelato-product-preview-dialog");
  const mockup = document.querySelector("#gelato-mockup-image");
  let image = null,
    url = "",
    position = { zoom: 1, panX: 0, panY: 0 },
    drag = null,
    loadRevision = 0;
  const specs = () =>
    productSpecs
      ? productSpecs()
      : Object.fromEntries(
          ["width", "height", "bleedMm", "wrapMm", "safeMm", "minimumDpi"].map((name) => [
            name,
            Number(form.elements[name].value),
          ]),
        );
  function draw() {
    const s = specs(),
      area = fullPrintArea(s);
    const aspect = Number.isFinite(area.widthIn / area.heightIn) ? area.widthIn / area.heightIn : 1;
    canvas.width = Math.round(720 * Math.min(1, aspect));
    canvas.height = Math.round(720 / Math.max(1, aspect));
    ctx.fillStyle = "#eeeeeb";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!image) {
      ctx.fillStyle = "#536258";
      ctx.textAlign = "center";
      ctx.font = "20px Georgia";
      ctx.fillText("Choose an image to begin", canvas.width / 2, canvas.height / 2);
      return;
    }
    const g = positionGeometry(
      image.naturalWidth,
      image.naturalHeight,
      area.widthIn,
      area.heightIn,
      position,
    );
    ctx.drawImage(
      image,
      g.sourceX,
      g.sourceY,
      g.cropWidth,
      g.cropHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const margin = (s.bleedMm + s.wrapMm) / 25.4;
    const left = (canvas.width * margin) / area.widthIn,
      top = (canvas.height * margin) / area.heightIn;
    ctx.fillStyle = "#ffffff66";
    ctx.fillRect(0, 0, canvas.width, top);
    ctx.fillRect(0, canvas.height - top, canvas.width, top);
    ctx.fillRect(0, top, left, canvas.height - top * 2);
    ctx.fillRect(canvas.width - left, top, left, canvas.height - top * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(left, top, canvas.width - left * 2, canvas.height - top * 2);
    const safeX = (canvas.width * (margin + s.safeMm / 25.4)) / area.widthIn;
    const safeY = (canvas.height * (margin + s.safeMm / 25.4)) / area.heightIn;
    ctx.strokeStyle = "#ffd56a";
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(safeX, safeY, canvas.width - 2 * safeX, canvas.height - 2 * safeY);
    ctx.setLineDash([]);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#3195c7";
    for (const [x, y] of [
      [8, 8],
      [canvas.width - 8, 8],
      [8, canvas.height - 8],
      [canvas.width - 8, canvas.height - 8],
    ]) {
      ctx.fillRect(x - 6, y - 6, 12, 12);
      ctx.strokeRect(x - 6, y - 6, 12, 12);
    }
    document.querySelector("#gelato-position-readout").textContent =
      `${s.width} × ${s.height} in · ${Math.round(position.zoom * 100)}% zoom · ${g.effectivePpi.toFixed(0)} source PPI`;
  }
  function update() {
    zoom.value = position.zoom;
    xControl.value = position.panX;
    yControl.value = position.panY;
    draw();
    changed();
  }
  for (const [control, key] of [
    [zoom, "zoom"],
    [xControl, "panX"],
    [yControl, "panY"],
  ])
    control.oninput = () => {
      position[key] = Number(control.value);
      update();
    };
  document.querySelector("#gelato-position-reset").onclick = () => {
    position = { zoom: 1, panX: 0, panY: 0 };
    update();
  };
  canvas.onkeydown = (event) => {
    if (!image) return;
    const keys = {
      ArrowLeft: ["panX", -0.02],
      ArrowRight: ["panX", 0.02],
      ArrowUp: ["panY", -0.02],
      ArrowDown: ["panY", 0.02],
      "+": ["zoom", 0.02],
      "=": ["zoom", 0.02],
      "-": ["zoom", -0.02],
    };
    const change = keys[event.key];
    if (!change) return;
    event.preventDefault();
    const [key, amount] = change;
    position[key] = clamp(position[key] + amount, key === "zoom" ? 1 : -1, key === "zoom" ? 4 : 1);
    update();
  };
  canvas.onpointerdown = (event) => {
    if (!image) return;
    canvas.setPointerCapture(event.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left,
      y = event.clientY - rect.top;
    drag = {
      x: event.clientX,
      y: event.clientY,
      position: savedPosition,
      rect,
      resize: (x < 30 || x > rect.width - 30) && (y < 30 || y > rect.height - 30),
      radius: Math.hypot(x - rect.width / 2, y - rect.height / 2),
    };
  };
  canvas.onpointermove = (event) => {
    if (!drag) return;
    if (drag.resize) {
      const radius = Math.hypot(
        event.clientX - drag.rect.left - drag.rect.width / 2,
        event.clientY - drag.rect.top - drag.rect.height / 2,
      );
      position.zoom = clamp((drag.position.zoom * radius) / Math.max(1, drag.radius), 1, 4);
    } else {
      const scale =
        Math.max(drag.rect.width / image.naturalWidth, drag.rect.height / image.naturalHeight) *
        position.zoom;
      position.panX = clamp(
        drag.position.panX +
          (2 * (event.clientX - drag.x)) /
            Math.max(1, image.naturalWidth * scale - drag.rect.width),
        -1,
        1,
      );
      position.panY = clamp(
        drag.position.panY +
          (2 * (event.clientY - drag.y)) /
            Math.max(1, image.naturalHeight * scale - drag.rect.height),
        -1,
        1,
      );
    }
    update();
  };
  canvas.onpointerup = canvas.onpointercancel = () => {
    drag = null;
  };
  async function render() {
    if (!image) throw Error("Choose an image first.");
    const savedPosition = { ...position };
    const s = specs(),
      geometry = positionedResolution(image.naturalWidth, image.naturalHeight, s, savedPosition);
    const output = document.createElement("canvas");
    output.width = geometry.width;
    output.height = geometry.height;
    output
      .getContext("2d")
      .drawImage(
        image,
        geometry.sourceX,
        geometry.sourceY,
        geometry.cropWidth,
        geometry.cropHeight,
        0,
        0,
        output.width,
        output.height,
      );
    const blob = await canvasBlob(output);
    if (blob.size > 104857600) throw Error("Positioned print file exceeds 100 MB.");
    const thumb = document.createElement("canvas");
    thumb.width = 720;
    thumb.height = Math.round((720 * output.height) / output.width);
    const tc = thumb.getContext("2d");
    tc.drawImage(output, 0, 0, thumb.width, thumb.height);
    tc.fillStyle = "#0008";
    tc.fillRect(0, thumb.height - 40, thumb.width, 40);
    tc.fillStyle = "#ffffffad";
    tc.font = "18px Georgia";
    tc.fillText("LWVADER · PROTECTED PREVIEW", 16, thumb.height - 14);
    return {
      blob,
      preview: await canvasBlob(thumb, "image/webp", 0.85),
      position: savedPosition,
      geometry,
    };
  }
  document.querySelector("#gelato-open-product-preview").onclick = () => {
    if (!image) return;
    const s = specs(),
      area = fullPrintArea(s),
      g = positionGeometry(
        image.naturalWidth,
        image.naturalHeight,
        area.widthIn,
        area.heightIn,
        position,
      );
    const thumb = document.createElement("canvas");
    thumb.width = 640;
    thumb.height = Math.round((640 * s.height) / s.width);
    // Product front excludes the entered wrap and bleed around its print file.
    const marginX = (g.cropWidth - (g.cropWidth * s.width) / area.widthIn) / 2;
    const marginY = (g.cropHeight - (g.cropHeight * s.height) / area.heightIn) / 2;
    thumb
      .getContext("2d")
      .drawImage(
        image,
        g.sourceX + marginX,
        g.sourceY + marginY,
        g.cropWidth - 2 * marginX,
        g.cropHeight - 2 * marginY,
        0,
        0,
        thumb.width,
        thumb.height,
      );
    mockup.src = thumb.toDataURL();
    document.querySelector("#gelato-mockup").dataset.tier = form.elements.edition_tier.value;
    document.querySelector("#gelato-mockup").dataset.frame = form.elements.frame_finish.value;
    modal.showModal();
  };
  document.querySelector("#gelato-close-product-preview").onclick = () => modal.close();
  for (const button of document.querySelectorAll("[data-product-view]"))
    button.onclick = () => {
      document.querySelector("#gelato-preview-scene").dataset.view = button.dataset.productView;
    };
  for (const name of ["width", "height", "bleedMm", "wrapMm", "safeMm", "minimumDpi"])
    form.elements[name]?.addEventListener("input", update);
  draw();
  return {
    async load(blob, savedPosition) {
      const revision = ++loadRevision;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      const next = new Image();
      next.src = url;
      await next.decode();
      if (revision !== loadRevision)
        throw Error("Image selection changed; load the current source again.");
      image = next;
      position = savedPosition
        ? { zoom: savedPosition.zoom, panX: savedPosition.panX, panY: savedPosition.panY }
        : { zoom: 1, panX: 0, panY: 0 };
      update();
      return { width: image.naturalWidth, height: image.naturalHeight };
    },
    clear() {
      loadRevision++;
      image = null;
      if (url) URL.revokeObjectURL(url);
      url = "";
      draw();
    },
    redraw: draw,
    render,
  };
}
