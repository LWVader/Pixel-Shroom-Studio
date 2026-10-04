// Read-only post-deployment smoke check. Never invokes payments or submits forms.
const base = new URL(process.env.SITE_TEST_URL || "https://www.pixelshroomstudio.com");
const paths = [
  "/",
  ...[
    "portrait",
    "fantasy",
    "landscape",
    "sci-fi",
    "abstract",
    "dreamscape",
    "dark-fantasy",
    "horror",
    "nft",
  ].map((g) => "/genre.html?genre=" + g),
  "/faq.html",
  "/contact.html",
  "/how-it-works.html",
  "/usage-rights.html",
  "/verify.html",
  "/privacy.html",
  "/terms.html",
  "/cookies.html",
  "/robots.txt",
  "/sitemap.xml",
  "/assets/hero-1280.webp",
];
let failed = 0;
for (const path of paths) {
  try {
    const response = await fetch(new URL(path, base), {
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const type = response.headers.get("content-type") || "";
    let ok = response.status === 200;
    if (type.includes("text/html")) {
      const text = await response.text();
      ok = ok && !text.includes("A world not found.") && text.includes("<h1");
    }
    console.log(`${ok ? "PASS" : "FAIL"} ${path} HTTP ${response.status}`);
    if (!ok) failed++;
  } catch (error) {
    console.error(`FAIL ${path}: ${error.message}`);
    failed++;
  }
}
process.exitCode = failed ? 1 : 0;
