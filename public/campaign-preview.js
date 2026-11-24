export const MAX_PREVIEW_BASE64 = 500_000;

function watermark(context, width, height) {
  // Matches the tile size, angle, and outlined type of the original protected viewer.
  const tile = document.createElement("canvas");
  tile.width = tile.height = 226;
  const stamp = tile.getContext("2d");
  stamp.translate(tile.width / 2, tile.height / 2);
  stamp.rotate(-Math.PI / 4);
  stamp.textAlign = "center";
  stamp.textBaseline = "middle";
  stamp.lineJoin = "round";
  stamp.lineWidth = 2;
  stamp.strokeStyle = "rgba(0,0,0,.58)";
  stamp.fillStyle = "rgba(255,255,255,.66)";
  for (const [text, size, y] of [["Example", 18, -10], ["PROTECTED PREVIEW", 12, 11]]) {
    stamp.font = `700 ${size}px Arial, sans-serif`;
    stamp.strokeText(text, 0, y);
    stamp.fillText(text, 0, y);
  }
  const pattern = context.createPattern(tile, "repeat");
  if (!pattern) throw new Error("Could not prepare the protected preview.");
  context.fillStyle = pattern;
  context.fillRect(0, 0, width, height);
}

export async function protectedCampaignPreview(file, maxWidth = 960, maxHeight = 640) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", {alpha: false});
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    watermark(context, canvas.width, canvas.height);
    const prefix = "data:image/webp;base64,";
    for (const quality of [.85, .72, .58]) {
      const data = canvas.toDataURL("image/webp", quality);
      if (data.startsWith(prefix) && data.length - prefix.length <= MAX_PREVIEW_BASE64) {
        return data.slice(prefix.length);
      }
    }
    throw new Error("Could not compress the protected preview.");
  } finally {
    bitmap.close();
  }
}
