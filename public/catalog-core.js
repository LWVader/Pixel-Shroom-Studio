// Shared by the browser and the routing Worker: the only supported genres.
export const GENRES = {
 portrait: {name:'Portrait', headline:'Characters with a story to tell.',description:'Explore expressive AI portraits and character artwork by LWVader, from cinematic figures to playful personalities.',definition:'Portrait art places a person, creature, or character at the center of the composition.'},
 fantasy: {name:'Fantasy',headline:'Step into the impossible.',description:'Discover magical places, imagined creatures, and detailed fantasy AI artwork from Pixel Shroom Studio.',definition:'Fantasy art builds imagined worlds with magic, mythical beings, and extraordinary settings.'},
 landscape: {name:'Landscape',headline:'A different kind of horizon.',description:'Explore natural vistas and imagined environments through landscape AI artwork by LWVader.',definition:'Landscape art focuses on a setting, including coastlines, mountains, forests, cities, and imagined terrain.'},
 'sci-fi': {name:'Sci-Fi',headline:'Tomorrow, imagined.',description:'Browse science-fiction AI artwork inspired by future worlds, technology, and cosmic exploration.',definition:'Science-fiction art explores speculative technology, space, and possible futures.'},
 abstract: {name:'Abstract',headline:'Follow the color.',description:'Discover abstract AI artwork built around expressive color, texture, geometry, and visual rhythm.',definition:'Abstract art emphasizes color, form, and texture rather than a literal representation of a subject.'},
 dreamscape: {name:'Dreamscape',headline:'Somewhere between worlds.',description:'Explore surreal AI artwork where familiar places become atmospheric, unexpected dreamscapes.',definition:'Dreamscape art combines surreal imagery and atmosphere to evoke a dream or an imagined memory.'},
 'dark-fantasy': {name:'Dark Fantasy',headline:'Beauty in the shadows.',description:'Discover gothic worlds, supernatural characters, and moody dark-fantasy AI artwork by LWVader.',definition:'Dark fantasy blends magical or supernatural subjects with gothic atmosphere and darker themes.'},
 horror: {name:'Horror',headline:'Stay for the strange.',description:'Explore eerie characters, unsettling settings, and cinematic horror AI artwork from Pixel Shroom Studio.',definition:'Horror art uses atmosphere, subjects, and composition to evoke unease or fear.'},
 nft: {name:'NFT',headline:'A new collection is coming.',description:'NFT releases from Pixel Shroom Studio are coming soon. Explore available digital artwork in the meantime.',definition:'An NFT is a blockchain token. Ownership and use terms depend on the release. NFT purchases are not offered on this storefront yet.'}
};
export const BASE = 'https://www.pixelshroomstudio.com';
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safePreviewUrl(value) {
 try { const url = new URL(String(value));return ['https:','http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
export const genreUrl = slug => `/genre.html?genre=${encodeURIComponent(slug)}`;
export const formatPrice = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value));
export function validRows(rows) {
 return Array.isArray(rows) ? rows.filter(x=>x && Object.values(GENRES).some(g=>g.name === x.category) && safePreviewUrl(x.preview_url) && Number.isFinite(Number(x.price)) && Number(x.price)>0) : [];
}
export function randomSample(rows,limit=4,rng=Math.random) {
 const result=[...rows];for(let i=result.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result.slice(0,limit);
}
export function cardMarkup(row,{interactive=true}={}) {
 const width=Math.min(1600,Math.max(160,Number(row.display_width)||600)),height=Math.min(1600,Math.max(120,Number(row.display_height)||600));
 const img=`<img src="${escapeHtml(safePreviewUrl(row.preview_url))}" width="${width}" height="${height}" loading="lazy" decoding="async" alt="${escapeHtml(row.title)}, protected ${escapeHtml(row.category.toLowerCase())} AI artwork preview by ${escapeHtml(row.artist||'LWVader')}">`;
 const preview=interactive?`<button type="button" class="art-image preview-trigger" data-image="${escapeHtml(safePreviewUrl(row.preview_url))}" data-title="${escapeHtml(row.title)}" data-serial="${escapeHtml(row.serial_number)}" aria-label="Enlarge protected preview of ${escapeHtml(row.title)}">${img}</button>`:`<div class="art-image">${img}</div>`;
 const actions=row.category==='NFT'?'<p class="muted">NFT release coming soon.</p>':`<div class="payment-actions" hidden><button class="button" type="button" data-buy="${escapeHtml(row.id)}" data-provider="stripe">Buy with Stripe ↗</button><button class="button secondary" type="button" data-buy="${escapeHtml(row.id)}" data-provider="paypal">Buy with PayPal ↗</button></div>`;
 return `<article class="art-card" data-artwork-id="${escapeHtml(row.id)}"><div>${preview}</div><div class="art-info"><p>${escapeHtml(row.category)} · ${escapeHtml(row.serial_number)}</p><div><h3>${escapeHtml(row.title)}</h3><span class="price">${formatPrice(row.price)}</span></div><p class="artist">by ${escapeHtml(row.artist||'LWVader')}</p>${actions}<p class="card-status muted" role="status"></p><a class="verify-link" href="/verify.html?serial=${encodeURIComponent(row.serial_number)}">Verify an original →</a></div></article>`;
}
function matching(rows,term) {const q=term.trim().toLowerCase();return rows.filter(x=>`${x.title} ${x.artist} ${x.category} ${x.serial_number}`.toLowerCase().includes(q));}
export function renderCompiled(rows,{term='',sampleIds}={}) {
 const visible=matching(rows,term);
 return Object.entries(GENRES).map(([slug,genre])=>{
 const all=visible.filter(x=>x.category===genre.name);
 const selected=sampleIds?.[slug] ? sampleIds[slug].map(id=>all.find(x=>String(x.id)===String(id))).filter(Boolean).slice(0,4) : randomSample(all,4);
 const message=slug==='nft'?'NFT releases are coming soon.':rows.length===0?'Check current listings in the full collection.':term&&!all.length?'No matches in this genre.':!all.length?'This collection is being prepared.':`${selected.length} of ${all.length} matching artwork${all.length===1?'':'s'}.`;
 return `<section class="genre-sample" data-genre-section="${slug}" aria-labelledby="sample-${slug}"><div class="genre-sample-heading"><div><p class="eyebrow">${genre.name} collection</p><h3 id="sample-${slug}">${genre.headline}</h3><p class="muted">${message}</p></div><a class="text-link" href="${genreUrl(slug)}">Take me to ${genre.name} →</a></div><div class="sample-grid">${selected.map(x=>cardMarkup(x)).join('')}</div></section>`;
 }).join('');
}
export function renderGenre(rows,slug,{term=''}={}) {
 const name=GENRES[slug]?.name;
 const list=matching(rows,term).filter(x=>x.category===name);
 if(!list.length) return `<div class="empty"><h2>${term?'No matching artwork':slug==='nft'?'Coming soon':'No published listings yet'}</h2><p>${term?'Try another title, artist, or serial.':slug==='nft'?'Explore digital artwork while NFT releases are prepared.':'Check back for additions or ask about custom artwork.'}</p><a class="text-link" href="/#gallery">Explore all artwork →</a></div>`;
 return list.map(x=>cardMarkup(x)).join('');
}
// Page through the public REST endpoint; never request original_path or private orders.
export async function readPublishedArtworks(base,key,{fetcher=fetch,signal}={}) {
 const rows=[],seen=new Set(),size=1000;
 for(let offset=0;offset<100000;offset+=size){
  const query=new URLSearchParams({select:'id,title,artist,category,serial_number,price,preview_url,display_width,display_height',status:'eq.published',order:'created_at.desc,id.desc',limit:String(size),offset:String(offset)});
  const response=await fetcher(`${base.replace(/\/$/,'')}/rest/v1/artworks?${query}`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal,cache:'no-store'});
  if(!response.ok)throw new Error('The live collection could not be loaded.');
  const page=await response.json();if(!Array.isArray(page))throw new Error('Invalid catalog response.');
  for(const row of page){if(seen.has(String(row.id)))throw new Error('Catalog pagination did not advance.');seen.add(String(row.id));rows.push(row);}
  if(page.length<size)return validRows(rows);
 }
 throw new Error('The catalog exceeded the supported page limit.');
}
export function checkoutUrl(value,provider) {
 const url=new URL(value);const hosts=provider==='stripe'?['checkout.stripe.com']:['www.paypal.com','www.sandbox.paypal.com','paypal.com','sandbox.paypal.com'];
 if(url.protocol!=='https:'||url.username||url.password||url.port||!hosts.includes(url.hostname))throw new Error('The payment provider returned an unsupported checkout URL.');
 return url.href;
}
