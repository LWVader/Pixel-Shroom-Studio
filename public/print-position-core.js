// Geometry shared by the browser editor and server-side print validation.
export function normalizePosition(value = {}) {
  const result = {
    zoom: Number(value.zoom ?? 1),
    panX: Number(value.panX ?? 0),
    panY: Number(value.panY ?? 0),
  };
  if (
    !Number.isFinite(result.zoom) ||
    result.zoom < 1 ||
    result.zoom > 4 ||
    ![result.panX, result.panY].every((n) => Number.isFinite(n) && n >= -1 && n <= 1)
  )
    throw Error("Image position is invalid. Reset and save the position again.");
  return result;
}
export function positionGeometry(sourceWidth, sourceHeight, widthIn, heightIn, position = {}) {
  if (![sourceWidth, sourceHeight, widthIn, heightIn].every((n) => Number.isFinite(n) && n > 0))
    throw Error("Load a valid image and canvas size first.");
  const p = normalizePosition(position);
  const scale = Math.max(widthIn / sourceWidth, heightIn / sourceHeight) * p.zoom;
  const cropWidth = widthIn / scale,
    cropHeight = heightIn / scale;
  return {
    ...p,
    sourceX: ((sourceWidth - cropWidth) * (1 - p.panX)) / 2,
    sourceY: ((sourceHeight - cropHeight) * (1 - p.panY)) / 2,
    cropWidth,
    cropHeight,
    effectivePpi: 1 / scale,
  };
}
export function fullPrintArea(specs) {
  const extra = (2 * (Number(specs.bleedMm) + Number(specs.wrapMm))) / 25.4;
  return { widthIn: Number(specs.width) + extra, heightIn: Number(specs.height) + extra };
}
export function positionedResolution(sourceWidth, sourceHeight, specs, position) {
  const area = fullPrintArea(specs);
  const geometry = positionGeometry(
    sourceWidth,
    sourceHeight,
    area.widthIn,
    area.heightIn,
    position,
  );
  if (geometry.effectivePpi + 0.01 < Number(specs.minimumDpi))
    throw Error(
      `Cannot save: this crop provides ${geometry.effectivePpi.toFixed(1)} PPI; the product requires ${specs.minimumDpi}. Reduce zoom or choose a larger source image.`,
    );
  const ppi = Math.min(300, geometry.effectivePpi);
  const width = Math.max(1, Math.floor(area.widthIn * ppi + 0.00001));
  const height = Math.max(1, Math.floor(area.heightIn * ppi + 0.00001));
  if (width * height > 100000000 || width > 16000 || height > 16000)
    throw Error("The print export is too large. Use a smaller print area or source.");
  return { ...area, ...geometry, width, height };
}
