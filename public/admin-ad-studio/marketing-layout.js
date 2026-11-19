'use strict';

function renderMarketingAd(ctx, state, time, height, logo) {
  const {x: margin, w: width, y: mediaTop, h: mediaHeight, edge: mediaBottom} = artworkRect(height);
  const ink = state[colorKey("textColor")];

  rounded(22, 22, 820, height - 44, 24, state[colorKey("cardColor")]);
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
  text(state.brand, brandX, 83, 26, ink, 700, state.captionFont, width - (brandX - margin));

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(margin, mediaTop, width, mediaHeight, 18);
  ctx.clip();
  const artworkColors = {
    dark: ["#171326", "#322044"], purple: ["#26143e", "#684184"], light: ["#e7e1ed", "#b8aac5"]
  };
  const [top, bottom] = artworkColors[state.background] || artworkColors.dark;
  const gradient = ctx.createLinearGradient(margin, mediaTop, margin + width, mediaBottom);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(margin, mediaTop, width, mediaHeight);
  const progress = time / Math.max(1, Number(state.duration));
  const zoom = Number(state.bgZoom) + (state.motion === "none" ? 0 : (1 - Math.cos(progress * Math.PI * 2)) * 2.5);
  paintArtwork(margin, mediaTop, width, mediaHeight, zoom);
  ctx.restore();

  drawCaption({...state, textColor: ink}, margin, mediaBottom + 30, width, height - mediaBottom - 207);
  if (state.cta.trim()) {
    rounded(margin, height - 148, width, 62, 11, "#d9ff55");
    text(state.cta, margin + 24, height - 108, 23, "#121408", 700, state.captionFont, width - 48);
  }
  text(state.website, margin, height - 53, 18, ink, 400, state.captionFont, width);
}

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
  state.bgDim = state.bgBlur = 0;
  state.bgImage = artwork;
  state.logoImage ||= BUNDLED_LOGO;
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
const preset = $("marketing-preset");
const presetButton = $("apply-marketing");
const spotlightSettings = $("spotlight-settings");
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
  const kind = preset.value;
  const campaign = kind === "spotlight" ? publishedCampaigns.get(campaignPicker.value) : null;
  if (kind === "spotlight" && !campaign) {
    adStatus.textContent = "Choose a published campaign for the spotlight.";
    return;
  }
  presetButton.disabled = true;
  try {
    const artwork = campaign ? await campaignArtwork(campaign) : BUNDLED_ARTWORK;
    if (recording || creative.value !== "marketing" || preset.value !== kind) return;
    applyMarketingAd(kind, campaign, artwork);
    adStatus.textContent = "Template loaded. Edit the copy, then export or publish.";
  } catch (error) {
    adStatus.textContent = error.message;
  } finally {
    presetButton.disabled = false;
  }
}

function syncSpotlightSettings() {
  spotlightSettings.hidden = preset.value !== "spotlight";
  adStatus.textContent = "";
}

preset.addEventListener("change", syncSpotlightSettings);
creative.addEventListener("change", () => {
  state.layout = creative.value;
  sync();
});
presetButton.addEventListener("click", loadMarketingPreset);
campaignMore.addEventListener("click", loadCampaigns);
$("edit-marketing-copy").addEventListener("click", () => {
  const headline = $("headline");
  $("ad-copy-settings").open = true;
  headline.focus();
});

applyMarketingAd("offer", null, BUNDLED_ARTWORK);
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
      preset.value = "spotlight";
      syncSpotlightSettings();
      await loadMarketingPreset();
    } catch (error) {
      adStatus.textContent = error.message;
    }
  })();
}
