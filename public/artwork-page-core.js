import {
  escapeHtml,
  safePreviewUrl,
  artworkDimensions,
  cardMarkup,
} from "./catalog-core.js?v=20261022-layout";
import { PLANNED_OFFERS, artUrl, money } from "./forge-print-core.js";
export function renderArtworkDetail(row) {
  if (row.category === "NFT")
    return `<section class="shell section"><p class="eyebrow">NFT release notifications</p><h1>${escapeHtml(row.title)}</h1><p>NFT purchases and new roll offers are not available for this collection.</p><a class="button" href="/?updates=nft#studio-updates">Request release notifications →</a></section>`;
  return `<section class="shell section art-detail"><div class="art-detail-viewer"><p class="eyebrow">Protected public preview</p><div class="finish-preview" data-preview-finish="slim"><button type="button" class="detail-preview-trigger preview-trigger" disabled data-image="${escapeHtml(safePreviewUrl(row.preview_url))}" data-title="${escapeHtml(row.title)}" data-serial="${escapeHtml(row.serial_number)}" aria-label="Enlarge protected preview of ${escapeHtml(row.title)}"><img src="${escapeHtml(safePreviewUrl(row.preview_url))}" width="${Number(row.display_width) || 600}" height="${Number(row.display_height) || 600}" alt="Protected preview of ${escapeHtml(row.title)} by LWVader" /></button></div><p class="muted">Select the image to enlarge its protected preview.</p>
 <label>Illustrative format<select id="finish-preview-select"><option value="slim">Slim canvas</option><option value="thick">Thick gallery canvas</option><option value="framed">Portrait floating frame</option></select></label><p class="muted">Format illustration using the protected preview. Final tier images and product-specific compositions can differ; this is not a manufacturing proof.</p></div>
 <div class="art-detail-copy"><p class="eyebrow">${escapeHtml(row.category)} · by ${escapeHtml(row.artist || "LWVader")}</p><h1>${escapeHtml(row.title)}</h1><p>Serial: ${escapeHtml(row.serial_number)}</p><p>${escapeHtml(artworkDimensions(row))}</p>
 <p class="offer-state">Forge &amp; Print preview — new roll checkouts are not open.</p><form id="offer-selector"><fieldset><legend>Select a planned offer</legend>${Object.entries(
   PLANNED_OFFERS,
 )
   .map(
     ([key, p]) =>
       `<label class="offer-choice"><input type="radio" name="offer" value="${key}" ${key === "canvas" ? "checked" : ""}/><span><strong>${escapeHtml(p.name)} — ${money(p.price)}</strong><small>${key === "canvas" ? "One digital variant + one prepaid canvas claim. $13.49 flat shipping; US delivery only." : `${p.count} digital image${p.count === 1 ? "" : "s"}. Physical printing is separate.`}</small></span></label>`,
   )
   .join("")}</fieldset>
 <p id="offer-summary" class="offer-total">$69.00 + $13.49 shipping = $82.49 before applicable tax</p><p id="offer-guarantee">The physical product follows the assigned tier. Hold the included print until you redeem it.</p>
 <button class="button" type="submit" disabled>Save planned selection to cart</button><p id="selection-status" role="status"></p></form>
 <p><a class="text-link" href="/drop-odds.html">Review base odds and bundle guarantees →</a></p><p>Standard 60% · Silver 20% · Gold 10% · Emerald 6% · Sapphire 3% · Prismatic 1%. New offer rules are previews; current edition odds/caps are shown below.</p>
 <p>Studio identification and signed-file verification establish source and integrity, not exclusivity. No blockchain token is included.</p><a class="text-link" href="/verify.html?serial=${encodeURIComponent(row.serial_number)}">Verify this source artwork →</a></div></section>
 <section class="shell section current-listing" aria-labelledby="current-listing-heading"><p class="eyebrow">Available purchase path</p><h2 id="current-listing-heading">Current listing options.</h2><p>These are the existing listing’s actual price and checkout. They do not include the planned $69 canvas benefit or $8 roll pricing.</p><p id="catalog-status" role="status"></p><div id="catalog" data-mode="detail" data-artwork-id="${escapeHtml(row.id)}" class="art-grid" aria-busy="false">${cardMarkup(row)}</div></section>`;
}
