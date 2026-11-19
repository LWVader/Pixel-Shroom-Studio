'use strict';

function renderMarketingAd(ctx, state, time, height, artwork, logo) {
  const margin = 56;
  const width = 864 - margin * 2;
  const mediaTop = 132;
  const mediaHeight = Math.min(height * .48, height - 425);
  const mediaBottom = mediaTop + mediaHeight;
  const accent = "#d9ff55";

  ctx.fillStyle = "#100e15";
  ctx.fillRect(0, 0, 864, height);
  const background = ctx.createLinearGradient(0, 0, 864, height);
  background.addColorStop(0, "#21162f");
  background.addColorStop(1, "#100e15");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 864, height);

  let brandX = margin;
  if (logo?.complete && logo.naturalWidth) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(margin, 44, 58, 58, 12);
    ctx.clip();
    coverImage(logo, margin, 44, 58, 58);
    ctx.restore();
    brandX += 76;
  }
  text(state.brand, brandX, 83, 26, "#f8f4ff", 700, state.captionFont, width - (brandX - margin));

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(margin, mediaTop, width, mediaHeight, 18);
  ctx.clip();
  ctx.fillStyle = "#322044";
  ctx.fillRect(margin, mediaTop, width, mediaHeight);
  if (artwork?.complete && artwork.naturalWidth) {
    const progress = time / Math.max(1, Number(state.duration));
    const zoom = Number(state.bgZoom) + (1 - Math.cos(progress * Math.PI * 2)) * 2.5;
    coverImage(artwork, margin, mediaTop, width, mediaHeight, zoom, Number(state.bgX), Number(state.bgY));
  }
  ctx.restore();

  drawCaption({...state, textColor: "#f8f4ff"}, margin, mediaBottom + 30, width, height - mediaBottom - 207);
  rounded(margin, height - 148, width, 62, 11, accent);
  text(state.cta, margin + 24, height - 108, 23, "#121408", 700, state.captionFont, width - 48);
  text(state.website, margin, height - 44, 18, "#c9bfd3", 400, state.captionFont, width);
}

const marketingArt = "/assets/campaigns/orbit-roast.webp";
const studioDomain = "pixelshroomstudio.com";

function applyMarketingAd(kind, campaign, artwork) {
  state.layout = "marketing";
  state.brand = "Pixel Shroom Studio";
  state.headline = kind === "spotlight" && campaign
    ? `${campaign.name}\n${campaign.tagline}`
    : kind === "portfolio" ? "Good ads. Weird worlds." : "Five campaign visuals for your next launch.";
  state.cta = kind === "offer" ? "Get the $199 Attention Pack" : "Explore the campaign work";
  state.website = studioDomain;
  state.socialTitle = campaign?.name || "Pixel Shroom Studio";
  const destination = campaign ? `https://www.${studioDomain}/?campaign=${campaign.id}#work` :
    `https://www.${studioDomain}/#${kind === "offer" ? "pack" : "work"}`;
  const body = kind === "spotlight" && campaign ? `${campaign.name} · ${campaign.tagline}` :
    kind === "portfolio" ? "Surreal campaigns for independent brands with a strange streak." :
      "Launching something new? Get five coordinated campaign visuals in the $199 Attention Pack.";
  state.socialCaption = `${body}\n\n${destination}`;
  state.captionFontSize = 40;
  state.captionAlign = "left";
  state.bgMode = "image";
  state.bgZoom = 100;
  state.bgX = state.bgY = 50;
  state.bgImage = artwork;
  state.logoImage ||= "/assets/pixel-shroom-logo-128.webp";
  restoreCustomAssets();
  t = 0;
  sync();
}

async function campaignArtwork(campaign) {
  const response = await fetch(campaign.imageUrl);
  if (!response.ok) throw new Error("Campaign artwork could not be loaded.");
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Campaign artwork could not be opened."));
    reader.readAsDataURL(blob);
  });
}

const creative = $("creative-layout");
const campaignPicker = $("marketing-campaign");
const campaignMore = $("marketing-more");
const presetButton = $("apply-marketing");
const adStatus = $("marketing-status");
let campaignOffset = 0;
const publishedCampaigns = new Map();

function addCampaign(item) {
  if (publishedCampaigns.has(item.id)) return;
  publishedCampaigns.set(item.id, item);
  const option = document.createElement("option");
  option.value = item.id;
  option.textContent = item.name;
  campaignPicker.append(option);
}

async function loadCampaigns() {
  campaignMore.disabled = true;
  try {
    const response = await fetch(`/api/portfolio?offset=${campaignOffset}`);
    if (!response.ok) return;
    const data = await response.json();
    for (const item of data.campaigns) addCampaign(item);
    campaignOffset += data.campaigns.length;
    campaignMore.hidden = !data.more;
  } catch { /* Bundled artwork is still available. */ }
  finally { campaignMore.disabled = false; }
}

async function loadMarketingPreset() {
  if (recording) return;
  const kind = $("marketing-preset").value;
  const campaign = publishedCampaigns.get(campaignPicker.value);
  if (kind === "spotlight" && !campaign) {
    adStatus.textContent = "Choose a published campaign for the spotlight.";
    return;
  }
  presetButton.disabled = true;
  try {
    const artwork = campaign ? await campaignArtwork(campaign) : marketingArt;
    applyMarketingAd(kind, campaign, artwork);
    adStatus.textContent = "Template loaded. Edit the copy, then export or publish.";
  } catch (error) {
    adStatus.textContent = error.message;
  } finally {
    presetButton.disabled = false;
  }
}

creative.addEventListener("change", () => {
  state.layout = creative.value;
  sync();
});
presetButton.addEventListener("click", loadMarketingPreset);
campaignMore.addEventListener("click", loadCampaigns);
$("edit-marketing-copy").addEventListener("click", () => {
  const headline = $("headline");
  headline.closest("details").open = true;
  headline.focus();
});

applyMarketingAd("offer", null, marketingArt);
void loadCampaigns();
const requestedCampaign = new URL(location.href).searchParams.get("campaign");
if (/^[a-f0-9-]{36}$/.test(requestedCampaign || "")) {
  void (async () => {
    try {
      const response = await fetch(`/api/portfolio?id=${encodeURIComponent(requestedCampaign)}`);
      if (!response.ok) throw new Error("This campaign is no longer published.");
      const item = await response.json();
      addCampaign(item);
      campaignPicker.value = item.id;
      $("marketing-preset").value = "spotlight";
      await loadMarketingPreset();
    } catch (error) {
      adStatus.textContent = error.message;
    }
  })();
}
