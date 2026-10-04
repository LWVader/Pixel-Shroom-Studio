// Static-host fallback only. Production serves the genre-specific HTML in the Worker.
import { GENRES, genreUrl } from "./catalog-core.js";
const slug = new URLSearchParams(location.search).get("genre")?.toLowerCase();
if (slug && Object.hasOwn(GENRES, slug)) {
  try {
    const response = await fetch(`/genres/${slug}.html?fragment=1`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error();
    const parsed = new DOMParser().parseFromString(await response.text(), "text/html");
    document.title = parsed.title;
    document.querySelector('meta[name="description"]').content = GENRES[slug].description;
    document.querySelector('link[rel="canonical"]').href =
      "https://www.pixelshroomstudio.com" + genreUrl(slug);
    for (const prop of [
      "og:title",
      "og:description",
      "og:url",
      "twitter:title",
      "twitter:description",
    ]) {
      const current = document.querySelector(`meta[property="${prop}"],meta[name="${prop}"]`),
        next = parsed.querySelector(`meta[property="${prop}"],meta[name="${prop}"]`);
      if (current && next) current.content = next.content;
    }
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => s.remove());
    for (const s of parsed.querySelectorAll('script[type="application/ld+json"]'))
      document.head.append(s.cloneNode(true));
    document.querySelector("#main").innerHTML = parsed.querySelector("#main").innerHTML;
    await import("./app.js");
  } catch {
    document.querySelector("#static-genre-fallback").textContent =
      "This collection could not be loaded. Please try again shortly.";
  }
}
