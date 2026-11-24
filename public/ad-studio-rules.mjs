export const MAX_VIDEO_BYTES = 16 * 1024 * 1024;
export const BUFFER_VIDEO_TYPES = ["video/mp4", "video/quicktime"];
const limits = {facebook: 5000, instagram: 2196, linkedin: 3000, pinterest: 500, tiktok: 2200,
  threads: 500, bluesky: 300, youtube: 5000, googlebusiness: 4000, twitter: 280};
export const CAPTION_PLATFORMS = [...Object.keys(limits), "mastodon"];
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, {granularity: "grapheme"}) : null;
const graphemes = text => segmenter ? Array.from(segmenter.segment(text), item => item.segment) : Array.from(text);

export function captionLength(platform, text) {
  const url = /https?:\/\/[^\s]+/g;
  let count = text.length;
  if (platform === "twitter") {
    count = graphemes(text.normalize("NFC").replace(url, "x".repeat(23))).reduce((total, char) => {
      if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(char)) return total + 2;
      const width = Array.from(char).reduce((n, point) => {
        const cp = point.codePointAt(0);
        return n + (cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) ||
          (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037) ? 1 : 2);
      }, 0);
      return total + width;
    }, 0);
  } else if (platform === "instagram") count += (text.match(/\n/g) || []).length;
  else if (platform === "linkedin") count = text.replace(url, "x".repeat(24)).length;
  else if (platform === "bluesky") count = graphemes(text).length;
  return {count, limit: limits[platform] || null};
}

export function publicMediaUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw Error("Enter a direct HTTPS video URL."); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || !host.includes(".") ||
      /[\[\]:]/.test(host) || /^\d+(\.\d+){3}$/.test(host) || /\.(local|internal|localhost)\.?$/.test(host) ||
      url.hash || url.href.length > 2000) throw Error("Use a public HTTPS video URL without credentials.");
  if (!/\.(mp4|mov)$/i.test(url.pathname)) throw Error("Use a direct MP4 or MOV file URL.");
  if (/(?:signature|token|expires|x-amz-|x-goog-)/i.test(url.search)) {
    throw Error("Use a stable video URL that will not expire before Buffer publishes.");
  }
  return url.href;
}
