import {industries} from "../public/industries.js";

const escapes = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"};
const escape = (value) => value.replace(/[&<>"']/g, (char) => escapes[char]);

export function campaignPage(campaign, origin) {
  const title = escape(`${campaign.name} | Pixel Shroom Studio`);
  const name = escape(campaign.name);
  const tagline = escape(campaign.tagline);
  const alt = escape(campaign.alt);
  const canonical = escape(new URL(campaign.sharePath, origin).href);
  const art = escape(new URL(`${campaign.sharePath}/artwork.webp?v=${campaign.version}`, origin).href);
  const industry = escape(industries[campaign.sector] || industries.other);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${tagline}">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/assets/pixel-shroom-logo-128.webp">
  <link rel="stylesheet" href="/studio.css">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Pixel Shroom Studio">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${tagline}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${art}">
  <meta property="og:image:type" content="image/webp">
  <meta property="og:image:alt" content="${alt}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${tagline}">
  <meta name="twitter:image" content="${art}">
  <meta name="twitter:image:alt" content="${alt}">
</head>
<body>
  <header class="site-header"><div class="wrap header-row campaign-header">
    <a href="/" class="wordmark"><img src="/assets/pixel-shroom-logo-128.webp" alt="" width="36" height="36">Pixel Shroom Studio</a>
    <a class="text-link" href="/#work">All campaigns</a>
  </div></header>
  <main class="wrap section campaign-page">
    <p class="eyebrow">${industry}</p>
    <h1>${name}</h1>
    <p class="campaign-tagline">${tagline}</p>
    <figure class="campaign-art"><img src="${art}" alt="${alt}"></figure>
    <div class="case-layout campaign-details">
      <section><h2>The brief</h2><p>${escape(campaign.brief)}</p></section>
      <section><h2>Why it works</h2><p>${escape(campaign.value)}</p></section>
    </div>
    <a class="button" href="/#pack">Explore the Attention Pack</a>
  </main>
</body>
</html>`;
}
