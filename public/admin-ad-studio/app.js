import {AdPalette} from "./ad-palette.js";
import {CHARACTER_CATALOG} from "./character-catalog.js";
import {MOTION_PRESETS, SceneEffects} from "./scene-effects.js";
import {FontLibrary} from "./fonts.js";
import {PROJECT_SCHEMA_VERSION, migrateAdProject} from "./project-version.js";
import {CAPTION_PLATFORMS} from "../ad-studio-rules.mjs";
import {exportAdVideo} from "./video-export.js";
import {renderMarketingAd, initMarketing} from "./marketing-layout.js";
import {updateCharacterSelection, initCharacterGallery} from "./character-gallery.js";
import {syncSocialCopy, initSocialPublishing} from "./social-publish.js";
import {initEmojiPicker} from "./emoji-picker.js";

'use strict';
const $=id=>document.getElementById(id), canvas=$('scene');let ctx=canvas.getContext('2d');const subjectLayer=document.createElement('canvas');
const CANVAS_WIDTH = 1080;
export let state={layout:'popout',model:'sir-shroomalot',motion:'none',showCharacter:false,brand:'Pixel Shroom Studio',headline:'Art that breaks the frame.',captionFont:'Arial',captionFontSize:28,captionWeight:'700',captionAlign:'left',socialTitle:'',socialCaption:'',youtubePrivacy:'public',pinterestBoard:'',channelCaptions:{},aiGenerated:true,cta:'Explore the collection ↗',website:'pixelshroomstudio.com',platform:'Instagram',depth:100,size:90,duration:6,ratio:'portrait',shadows:true,characterImage:null,bgImage:null,outerImage:null,logoImage:null,artworkPlacement:'template',bgFit:'contain',bgZoom:100,bgX:50,bgY:50,bgDim:15,bgBlur:0,subjectX:0,subjectY:0,characterName:'Sir Shroomalot',weatherType:'snow',weatherLayer:'both',weatherDensity:65,weatherSpeed:100,weatherWind:15,burnOrigin:'bottom',burnIntensity:65,burnSmoke:true,burnEmbers:true,emberAmount:45},t=0,playing=true,last=0,orbit=0,tilt=0,drag=null,recording=false;
const PLAYBACK_RATE = .5;
const BUNDLED_ARTWORK = "/admin-ad-studio/assets/campaign-art/orbit-roast.webp";
const OLD_BUNDLED_ARTWORK = "/assets/campaigns/orbit-roast.webp";
const BUNDLED_LOGO = "/assets/pixel-shroom-logo-128.webp";
state.palette = AdPalette.defaultPalette;
state.paletteName = "";
const defaults = {...state};
state.channelCaptions = {};
let paletteTheme = AdPalette.roles(state.palette);
let renderedPalette = state.palette;
const syncPaletteEditor = AdPalette.editor((colors, name) => {
  state.palette = colors;
  state.paletteName = name;
  sync();
});

function toast(s){$('toast').textContent=s;$('toast').style.display='block';setTimeout(()=>$('toast').style.display='none',3500)}
function rounded(x,y,w,h,r,fill){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill()}
function text(s,x,y,size,color='#fff',weight=500,family='sans-serif',maxWidth=0){ctx.fillStyle=color;ctx.font=`${FontLibrary.weight(family,weight)} ${size}px "${family}", "Noto Emoji", sans-serif`;while(maxWidth&&size>8&&ctx.measureText(s).width>maxWidth){size--;ctx.font=`${FontLibrary.weight(family,weight)} ${size}px "${family}", "Noto Emoji", sans-serif`}ctx.fillText(s,x,y)}
function setText(id, value) {
  const element = $(id);
  if (element.textContent !== value) element.textContent = value;
}

let captionLayout;
function drawCaption(s, x, y, w, h) {
  const family = s.captionFont || "Arial", requested = Number(s.captionFontSize) || 28;
  const weight = FontLibrary.weight(family, s.captionWeight || "700");
  const key = JSON.stringify([s.headline, requested, family, weight, w, h, FontLibrary.generation]);
  if (captionLayout?.key !== key) {
    let size = requested;
    function wrap() {
      ctx.font = `${weight} ${size}px "${family}", "Noto Emoji", sans-serif`;
      const rows = [];
      for (const paragraph of s.headline.split("\n")) {
        let line = "";
        for (const word of paragraph.split(/\s+/).filter(Boolean)) {
          const next = line ? line + " " + word : word;
          if (ctx.measureText(next).width <= w) { line = next; continue; }
          if (line) rows.push(line);
          line = "";
          for (const char of word) {
            if (line && ctx.measureText(line + char).width > w) { rows.push(line); line = ""; }
            line += char;
          }
        }
        rows.push(line);
      }
      return rows;
    }
    let rows = wrap();
    while (size > 6 && rows.length * size * 1.22 > h) {
      size--;
      rows = wrap();
    }
    captionLayout = {key, size, rows};
  }
  const {size, rows} = captionLayout;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.textAlign = s.captionAlign || "left";
  const anchor = s.captionAlign === "center" ? x + w / 2 : s.captionAlign === "right" ? x + w : x;
  rows.forEach((row, i) => text(row, anchor, y + size + i * size * 1.22, size, s.textColor, weight, family));
  ctx.restore();
  setText("captionFit", size < requested ? "Caption fitted to " + size + "px on the ad." : "Caption uses " + size + "px on the ad.");
}
const characters={};
for(const entry of CHARACTER_CATALOG){const img=loadImage(entry.src);characters[entry.id]=img;}
const isCharacterModel=model=>model==='custom'||Object.hasOwn(characters,model);
let characterUpload=null,backdrop=null,outerBackdrop=null,brandLogo=null;
let characterHitArea = null;
const extraControls = [
  "captionFont", "captionFontSize", "captionWeight", "captionAlign",
  "artworkPlacement", "bgFit", "bgZoom", "bgX", "bgY", "bgDim", "bgBlur", "weatherType", "weatherLayer",
  "weatherDensity", "weatherSpeed", "weatherWind", "burnOrigin", "burnIntensity", "burnSmoke", "burnEmbers", "emberAmount"
];
function coverImage(image, x, y, width, height, zoom = 100, horizontal = 50, vertical = 50, fit = "cover") {
  const scaleToFit = fit === "contain" ? Math.min : Math.max;
  const scale = scaleToFit(width / image.naturalWidth, height / image.naturalHeight) * zoom / 100;
  const drawnWidth = image.naturalWidth * scale;
  const drawnHeight = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - drawnWidth) * horizontal / 100,
    y + (height - drawnHeight) * vertical / 100, drawnWidth, drawnHeight);
}

function paintCanvas(height) {
  ctx.fillStyle = paletteTheme.canvas;
  ctx.fillRect(0, 0, 864, height);
  if (outerBackdrop?.complete && outerBackdrop.naturalWidth) {
    coverImage(outerBackdrop, 0, 0, 864, height);
  }
}

function paintArtwork(x, y, width, height, zoom = Number(state.bgZoom)) {
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, paletteTheme.post);
  gradient.addColorStop(1, paletteTheme.scene);
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);
  if (backdrop?.complete && backdrop.naturalWidth) {
    ctx.save();
    ctx.filter = `blur(${state.bgBlur}px)`;
    // Whole-image mode must never crop, even when a previous cover-mode
    // project stored an enlarged zoom value.
    coverImage(backdrop, x, y, width, height, state.bgFit === "contain" ? 100 : zoom,
      Number(state.bgX), Number(state.bgY), state.bgFit);
    ctx.restore();
    ctx.fillStyle = `rgba(0,0,0,${Number(state.bgDim) / 100})`;
    ctx.fillRect(x, y, width, height);
  }
}

const canvasHeights = {square: 1080, story: 1920, portrait: 1350};
const logicalHeight = () => canvas.height * 864 / CANVAS_WIDTH;
const hasCharacter = () => state.layout === "popout" || state.showCharacter;
const characterImage = () => state.model === "custom" ? characterUpload : characters[state.model];

function artworkRect(height) {
  const marketing = state.layout === "marketing";
  if (marketing && state.artworkPlacement === "canvas" && state.bgImage) {
    return {x: 0, y: 0, w: 864, h: height, edge: height};
  }
  if (marketing) {
    const y = 132;
    // Give art all the space available above the copy/CTA. Reserve room
    // for the logo, headline, button and footer at every export ratio.
    const buttonY = state.ratio === "story" ? height * .77 - 115 : height - 148;
    const maxWidth = 752, maxHeight = Math.max(1, buttonY - y - 128);
    let w = maxWidth, h = maxHeight;
    if (state.bgFit === "contain" && backdrop?.complete && backdrop.naturalWidth) {
      const scale = Math.min(maxWidth / backdrop.naturalWidth, maxHeight / backdrop.naturalHeight);
      w = backdrop.naturalWidth * scale;
      h = backdrop.naturalHeight * scale;
    }
    return {x: (864 - w) / 2, y, w, h, edge: y + h};
  }
  const y = 172, h = Math.min(440, height * .36);
  return {x: 122, y, w: 620, h, edge: y + h};
}

function characterCenterY(rect) {
  return Math.round(rect.y + rect.h * .49);
}

function syncPlacement(x = state.subjectX, y = state.subjectY) {
  const height = logicalHeight();
  const anchorY = characterCenterY(artworkRect(height));
  const previousX = state.subjectX, previousY = state.subjectY;
  state.subjectX = Math.round(Math.max(-432, Math.min(432, Number(x) || 0)));
  state.subjectY = Math.round(Math.max(-anchorY, Math.min(height - anchorY, Number(y) || 0)));
  $("subjectY").min = -anchorY;
  $("subjectY").max = height - anchorY;
  $("subjectX").value = state.subjectX;
  $("subjectY").value = state.subjectY;
  $("subjectXOut").value = Math.round((432 + state.subjectX) / 864 * 100) + "%";
  $("subjectYOut").value = Math.round((anchorY + state.subjectY) / height * 100) + "%";
  $("sizeOut").value = state.size + "%";
  if (previousX !== state.subjectX || previousY !== state.subjectY) updateRenderRevision();
}

function paintCharacter(rect, height) {
  characterHitArea = null;
  if (state.motion !== "none") SceneEffects.before(ctx, state, t, rect, paletteTheme.post);
  const image = characterImage();
  if (hasCharacter() && image?.complete && image.naturalWidth) {
    const {u, emerge, bob, angle, slideX} = SceneEffects.motion(t, state);
    const reach = emerge * Number(state.depth) / 100;
    const h = rect.h * .73 * Number(state.size) / 90 * (1 + reach * .78);
    const w = h * image.naturalWidth / image.naturalHeight * (1 + Math.sin(orbit) * .12);
    const drawnHeight = h * (1 - Math.abs(tilt) * .07);
    const x = 432 + state.subjectX + Math.sin(u * 6.28) * reach * 8 + slideX;
    const y = Math.max(0, Math.min(height, characterCenterY(rect) + state.subjectY + reach * rect.h * .32 + bob));
    const rotation = angle + orbit * .1;
    const c = Math.abs(Math.cos(rotation)), s = Math.abs(Math.sin(rotation));
    characterHitArea = {x, y, w: c * w + s * drawnHeight, h: s * w + c * drawnHeight};

    const effects = state.motion === "melt" || state.motion === "explode" || state.motion === "glitch";
    if (effects && (subjectLayer.width !== canvas.width || subjectLayer.height !== canvas.height)) {
      subjectLayer.width = canvas.width;
      subjectLayer.height = canvas.height;
    }
    const layer = effects ? subjectLayer.getContext("2d") : ctx;
    if (effects) {
      const scale = canvas.width / 864;
      layer.setTransform(scale, 0, 0, scale, 0, 0);
      layer.clearRect(0, 0, 864, height);
    }
    layer.save();
    layer.translate(x, y);
    layer.rotate(rotation);
    if (state.shadows) {
      layer.shadowColor = "#10191365";
      layer.shadowBlur = Math.min(22, h * .04);
      layer.shadowOffsetY = Math.min(16, h * .035);
    }
    layer.drawImage(image, -w / 2, -drawnHeight / 2, w, drawnHeight);
    layer.restore();

    if (effects) SceneEffects.subject(ctx, subjectLayer, state, t, {cx: x, cy: y, size: h, width: w, height: drawnHeight});
  }
  if (state.motion !== "none") SceneEffects.after(ctx, state, t, rect);
}

function draw(){const s=canvas.width/864;ctx.setTransform(s,0,0,s,0,0);const h=logicalHeight();
paintCanvas(h);
if(state.layout==='marketing'){
  renderMarketingAd(ctx,state,t,h,brandLogo);
  paintCharacter(artworkRect(h), h);
  updatePlaybackClock();
  return;
}
  const px = 104, pw = 656, py = 62, ph = h - 124;
  const {post, ink, outline, button, buttonInk} = paletteTheme;
  const rect = artworkRect(h);
  const {x, y, w, h: mediaHeight, edge} = rect;
  ctx.save();
  ctx.shadowColor = "#0005";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 12;
  rounded(px, py, pw, ph, 18, outline);
  ctx.restore();
  rounded(px + 1, py + 1, pw - 2, ph - 2, 17, post);
  let brandX = px + 29;
  if (brandLogo?.complete && brandLogo.naturalWidth) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(px + 51, py + 53, 25, 0, Math.PI * 2);
    ctx.clip();
    coverImage(brandLogo, px + 26, py + 28, 50, 50);
    ctx.restore();
    brandX = px + 91;
  }
  text(state.brand, brandX, py + 47, 22, ink, 700, state.captionFont, pw - 156);
  text(state.platform, brandX, py + 73, 15, ink);
  text("•••", px + pw - 60, py + 55, 25, ink);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, mediaHeight, 5);
  ctx.clip();
  paintArtwork(x, y, w, mediaHeight);
  ctx.restore();

  const story = state.ratio === "story";
  const buttonY = story ? h * .77 - 115 : h - 171;
  const copyY = story ? edge + 30 : Math.max(edge + 30, h - 300);
  drawCaption({...state, textColor: ink}, px + 30, copyY, pw - 60, buttonY - 20 - copyY);
  if (state.cta.trim()) {
    rounded(px + 28, buttonY, pw - 56, 55, 8, button);
    text(state.cta, px + 49, buttonY + 35, 20, buttonInk, 700, state.captionFont, pw - 100);
  }
  text(state.website, px + 30, story ? buttonY + 83 : h - 88, 15, ink, 400, state.captionFont, pw - 60);
  paintCharacter(rect, h);
  updatePlaybackClock();
}

function updatePlaybackClock() {
  setText("time", (t / PLAYBACK_RATE).toFixed(1) + " / " + (state.duration / PLAYBACK_RATE).toFixed(1) + "s");
  const seek = $("seek"), value = (t / PLAYBACK_RATE).toFixed(2);
  if (Number(seek.value) !== Number(value)) seek.value = value;
}

const renderFields = Object.keys(defaults).filter(key => ![
  "socialTitle", "socialCaption", "channelCaptions", "youtubePrivacy", "pinterestBoard", "aiGenerated", "paletteName", "characterName"
].includes(key));
let renderRevision = 0;
let lastVisual;
function updateRenderRevision() {
  const visual = [...renderFields.map(key => state[key]), orbit, tilt];
  if (lastVisual && visual.every((value, i) => Object.is(value, lastVisual[i]))) return;
  lastVisual = visual;
  renderRevision++;
  requestPreview();
}

let previewFrame = 0;
let previewDirty = true;
function canPreview() { return !$("editorPage").hidden && !document.hidden && !recording; }
function requestPreview() {
  previewDirty = true;
  if (!previewFrame && canPreview()) previewFrame = requestAnimationFrame(frame);
}
function frame(now) {
  previewFrame = 0;
  if (!canPreview()) { last = 0; return; }
  if (previewDirty || (playing && !drag && (!last || now - last >= 1000 / 30 - .25))) {
    if (last && playing && !drag) t = (t + (now - last) / 1000 * PLAYBACK_RATE) % state.duration;
    last = now;
    const dirty = previewDirty;
    previewDirty = false;
    if (dirty || state.motion !== "none" || playing === false || lastPaintedRevision !== renderRevision) {
      draw();
      lastPaintedRevision = renderRevision;
    } else updatePlaybackClock();
  }
  if (playing && !drag) previewFrame = requestAnimationFrame(frame);
}
let lastPaintedRevision = -1;
document.addEventListener("visibilitychange", () => { last = 0; requestPreview(); });
const regularControls = ["brand", "headline", "cta", "website", "platform", "depth", "size", "duration", "ratio", "shadows", "showCharacter"];

function sync() {
  document.body.dataset.adLayout = state.layout;
  $("creative-layout").value = state.layout;
  syncSocialCopy();
  if (renderedPalette !== state.palette) {
    renderedPalette = state.palette;
    paletteTheme = AdPalette.roles(state.palette);
  }
  syncPaletteEditor(state.palette, state.paletteName, paletteTheme);
  FontLibrary.sync(state, paletteTheme);

  const isPopout = state.layout === "popout";
  const visible = hasCharacter();
  $("characterSection").hidden = $("character-placement").hidden = $("character-stage-note").hidden = !visible;
  $("depth-setting").hidden = state.motion === "none";
  canvas.classList.toggle("character-visible", visible);
  updateCharacterSelection();

  $("artwork-title").textContent = isPopout ? "Scene background" : "Campaign artwork";
  $("bgAdjust").hidden = !state.bgImage;
  $("artwork-placement-help").hidden = isPopout;
  $("artwork-placement-help").textContent = state.artworkPlacement === "canvas"
    ? "Full canvas shows your artwork without an extra logo, headline or button."
    : "The artwork area automatically fits the complete image between the brand header and the caption and button.";
  for (const id of ["bgZoom", "bgX", "bgY"]) $(id).disabled = state.bgFit === "contain";
  $("clearBg").hidden = !state.bgImage;
  $("clearOuter").hidden = !state.outerImage;
  $("clearLogo").hidden = !state.logoImage;

  const motion = MOTION_PRESETS.find((preset) => preset.id === state.motion);
  $("motionHint").textContent = motion?.description || "";
  $("effectSettings").hidden = !["weather", "page-burn"].includes(state.motion);
  $("weatherSettings").hidden = state.motion !== "weather";
  $("burnSettings").hidden = state.motion !== "page-burn";
  $("effectTitle").textContent = state.motion === "weather" ? "Weather settings" : "Burn settings";
  for (const id of [...regularControls, ...extraControls]) {
    const input = $(id);
    const value = state[id];
    if (input.type === "checkbox") input.checked = value;
    else input.value = id === "duration" ? Number(value) / PLAYBACK_RATE : value;
  }
  $("depthOut").value = state.depth + "%";
  $("durationOut").value = Number(state.duration) / PLAYBACK_RATE + "s";
  $("seek").max = Number(state.duration) / PLAYBACK_RATE;
  const height = canvasHeights[state.ratio];
  if (canvas.width !== CANVAS_WIDTH || canvas.height !== height) {
    canvas.width = CANVAS_WIDTH;
    canvas.height = height;
  }
  canvas.parentElement.style.setProperty("--scene-aspect", CANVAS_WIDTH / height);
  $("safe-zone-control").hidden = state.ratio !== "story";
  $("safe-zone-guide").hidden = state.ratio !== "story" || !$("safe-zone").checked;
  syncPlacement();
  updateRenderRevision();
  for (const button of document.querySelectorAll("[data-motion]")) {
    const selected = button.dataset.motion === state.motion;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", selected);
  }
}

for (const id of [...regularControls, ...extraControls]) {
  $(id).addEventListener("input", (event) => {
    const input = event.currentTarget;
    state[id] = id === "duration" ? Number(input.value) * PLAYBACK_RATE :
      input.type === "checkbox" ? input.checked : input.value;
    t = Math.min(t, Number(state.duration));
    sync();
  });
}

$("subjectX").oninput = () => syncPlacement($("subjectX").value, state.subjectY);
$("subjectY").oninput = () => syncPlacement(state.subjectX, $("subjectY").value);

for (const button of document.querySelectorAll("[data-motion]")) {
  button.addEventListener("click", () => {
    state.motion = button.dataset.motion;
    t = 0;
    sync();
    requestPreview();
  });
}

function setPlaying(value) {
  playing = value;
  last = 0;
  requestPreview();
  $("play").textContent = playing ? "Pause" : "Play";
  $("play").setAttribute("aria-label", playing ? "Pause preview" : "Play preview");
}

$("play").onclick = () => { if (!recording) setPlaying(!playing); };
$("restart").onclick = () => { if (!recording) { t = 0; last = 0; requestPreview(); } };
$("seek").oninput = () => {
  if (recording) return;
  t = Number($("seek").value) * PLAYBACK_RATE;
  setPlaying(false);
};

canvas.onpointerdown = (event) => {
  if (!hasCharacter() || recording || !event.isPrimary || event.button !== 0 || !characterHitArea) return;
  const bounds = canvas.getBoundingClientRect();
  const sx = 864 / bounds.width, sy = logicalHeight() / bounds.height;
  const x = (event.clientX - bounds.left) * sx, y = (event.clientY - bounds.top) * sy;
  const area = characterHitArea;
  if (Math.abs(x - area.x) > area.w / 2 || Math.abs(y - area.y) > area.h / 2) return;
  drag = {pointer: event.pointerId, x: event.clientX, y: event.clientY, sx, sy, startX: state.subjectX, startY: state.subjectY};
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("character-dragging");
};
canvas.onpointermove = (event) => {
  if (drag?.pointer !== event.pointerId) return;
  syncPlacement(drag.startX + (event.clientX - drag.x) * drag.sx, drag.startY + (event.clientY - drag.y) * drag.sy);
};
canvas.onlostpointercapture = () => {
  drag = null;
  last = 0;
  canvas.classList.remove("character-dragging");
  requestPreview();
};
function download(blob,name){let url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
$("save").onclick = () => {
  const project = JSON.stringify({...state, schemaVersion: PROJECT_SCHEMA_VERSION, duration: state.duration / PLAYBACK_RATE, orbit, tilt}, null, 2);
  download(new Blob([project], {type: "application/json"}), state.layout === "marketing" ? "campaign-project.json" : "popout-project.json");
  toast("Project downloaded as JSON.");
};
$("load").onclick = () => { if (!recording) $("projectFile").click(); };
$("projectFile").onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || recording) return;
  try {
    const original = JSON.parse(await file.text());
    const data = migrateAdProject(original);
    const oldProduct = ["canvas", "box"].includes(original.model);
    if (!isCharacterModel(data.model) || !MOTION_PRESETS.some(({id}) => id === data.motion)) throw Error("Invalid project.");
    await FontLibrary.catalogReady;
    if (recording) return;
    state = {...defaults};
    for (const key of Object.keys(state)) if (Object.hasOwn(data, key)) state[key] = data[key];
    state.duration = Number(data.duration) * PLAYBACK_RATE;
    sanitizeProject();
    orbit = Number.isFinite(Number(data.orbit)) ? Number(data.orbit) : 0;
    tilt = Math.max(-.8, Math.min(.8, Number(data.tilt) || 0));
    restoreCustomAssets();
    characterUpload = loadImage(state.characterImage);
    t = 0;
    sync();
    requestPreview();
    toast(oldProduct ? "Project opened as a character ad." : "Project opened.");
  } catch (error) {
    toast(error.message === "This project version is unsupported." ? error.message : "Please select a valid AD Studio project JSON.");
  }
};
$('snapshot').onclick=()=>{if(!assetsReady())return toast('Wait for your images and selected font to load.');draw();canvas.toBlob(b=>download(b,state.layout==='marketing'?'campaign-ad.png':'popout-frame.png'),'image/png')};
async function renderAnimation(onProgress = () => {}, {publish = false, announce = () => {}} = {}) {
  if (recording) throw Error("Already recording.");
  if (!assetsReady()) throw Error("Wait for your images and selected font to load.");
  const previous = playing, oldTime = t;
  recording = true;
  playing = false;
  $("editorPage").inert = true;
  $("export").disabled = true;
  $("export").textContent = "Rendering…";
  try {
    await prepareExportSymbols().catch(() => {});
    return await exportAdVideo(canvas, state.duration / PLAYBACK_RATE, {
      publish, announce, progress: onProgress,
      paint(seconds) { t = seconds * PLAYBACK_RATE; draw(); }
    });
  } finally {
    recording = false;
    playing = previous;
    t = oldTime;
    last = 0;
    lastPaintedRevision = -1;
    $("editorPage").inert = false;
    $("export").disabled = false;
    $("export").textContent = "Export video";
    requestPreview();
  }
}
$('export').onclick=async()=>{try{const blob=await renderAnimation();download(blob,(state.layout==='marketing'?'campaign-ad.':'popout-ad.')+(blob.type.includes('mp4')?'mp4':'webm'));toast('Video downloaded.')}catch(error){toast(error.message)}};

function assetsReady() {
  if (!FontLibrary.ready(state.captionFont)) return false;
  const images = [brandLogo];
  images.push(backdrop, outerBackdrop);
  if (hasCharacter()) images.push(characterImage());
  return images.filter(Boolean).every((image) => image.complete && image.naturalWidth > 0);
}
async function prepareImage(file) {
  if (file.size > 12 * 1024 * 1024) throw Error("Choose an image under 12 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    const resized = document.createElement("canvas");
    resized.width = Math.max(1, Math.round(image.naturalWidth * scale));
    resized.height = Math.max(1, Math.round(image.naturalHeight * scale));
    resized.getContext("2d").drawImage(image, 0, 0, resized.width, resized.height);
    const data = resized.toDataURL("image/webp", .9);
    const source = loadImage(data);
    await source.decode();
    return {source, data};
  } finally {
    URL.revokeObjectURL(url);
  }
}

function bindImageUpload(id, apply) {
  $(id).onchange = async event => {
    const input = event.currentTarget;
    const file = input.files[0];
    if (!file) return;
    const project = state;
    try {
      const image = await prepareImage(file);
      if (state !== project || input.files[0] !== file || recording) return;
      apply(image, file);
      sync();
    } catch (error) {
      toast(file.size > 12 * 1024 * 1024 ? error.message : "This image could not be loaded.");
    }
  };
}

bindImageUpload("characterUpload", ({source, data}, file) => {
  characterUpload = source;
  state.characterImage = data;
  state.model = "custom";
  state.characterName = file.name.replace(/\.[^.]+$/, "").slice(0, 60);
  toast("Character loaded. Name it and save it to your character collection.");
});

function loadImage(source) {
  if (!source) return null;
  const image = new Image();
  image.addEventListener("load", () => { lastPaintedRevision = -1; requestPreview(); });
  image.src = source;
  return image;
}

function restoreCustomAssets() {
  for (const id of ["bgUpload", "outerUpload", "logoUpload"]) $(id).value = "";
  backdrop = loadImage(state.bgImage);
  outerBackdrop = loadImage(state.outerImage);
  brandLogo = loadImage(state.logoImage);
}
bindImageUpload("bgUpload", ({source, data}) => {
  backdrop = source;
  state.bgImage = data;
  if (state.layout !== "marketing") state.artworkPlacement = "template";
  state.bgFit = "contain";
  state.bgZoom = 100;
  state.bgX = state.bgY = 50;
  state.bgDim = state.bgBlur = 0;
});
bindImageUpload("outerUpload", ({source, data}) => { outerBackdrop = source; state.outerImage = data; });
bindImageUpload("logoUpload", ({source, data}) => { brandLogo = source; state.logoImage = data; });
$('clearBg').onclick=()=>{state.bgImage=null;backdrop=null;$('bgUpload').value='';sync()};$('clearOuter').onclick=()=>{state.outerImage=null;outerBackdrop=null;$('outerUpload').value='';sync()};$('clearLogo').onclick=()=>{state.logoImage=null;brandLogo=null;$('logoUpload').value='';sync()};
$("resetView").onclick = () => {
  orbit = tilt = state.subjectX = state.subjectY = 0;
  state.size = defaults.size;
  sync();
};

function sanitizeProject() {
  const textFields = {brand: 45, cta: 45, website: 60, headline: 600, socialTitle: 100, socialCaption: 25000,
    pinterestBoard: 100, characterName: 60};
  for (const [id, limit] of Object.entries(textFields)) {
    state[id] = String(state[id] ?? "").slice(0, limit);
  }
  const bounds = {
    size: [10, 180], duration: [3, 12], depth: [0, 100], captionFontSize: [14, 40], bgZoom: [100, 250],
    bgX: [0, 100], bgY: [0, 100], bgDim: [0, 80], bgBlur: [0, 12], weatherDensity: [20, 120],
    weatherSpeed: [40, 200], weatherWind: [-80, 80], burnIntensity: [20, 100], emberAmount: [10, 100]
  };
  for (const [key, [low, high]] of Object.entries(bounds)) {
    const value = Number(state[key]);
    state[key] = Math.max(low, Math.min(high, Number.isFinite(value) ? value : defaults[key]));
  }
  for (const key of ["showCharacter", "aiGenerated", "shadows", "burnSmoke", "burnEmbers"]) {
    if (typeof state[key] !== "boolean") state[key] = defaults[key];
  }
  state.channelCaptions = state.channelCaptions && typeof state.channelCaptions === "object"
    ? Object.fromEntries(Object.entries(state.channelCaptions).filter(([key, value]) =>
      CAPTION_PLATFORMS.includes(key) && typeof value === "string").map(([key, value]) => [key, value.slice(0, 25000)]))
    : {};
  state.palette = AdPalette.normalize(state.palette) || defaults.palette;
  state.paletteName = typeof state.paletteName === "string" ? state.paletteName.trim().slice(0, 48) : "";
  const options = {
    layout: ["marketing", "popout"], artworkPlacement: ["canvas", "template"], bgFit: ["cover", "contain"], ratio: Object.keys(canvasHeights),
    platform: ["Instagram", "Facebook", "TikTok"], captionAlign: ["left", "center", "right"], captionWeight: ["400", "700"],
    youtubePrivacy: ["public", "unlisted", "private"], weatherType: ["snow", "rain", "storm", "petals", "confetti"],
    weatherLayer: ["behind", "front", "both"], burnOrigin: ["bottom", "center"]
  };
  state.captionWeight = String(state.captionWeight);
  for (const [key, values] of Object.entries(options)) if (!values.includes(state[key])) state[key] = defaults[key];
  if (!FontLibrary.valid(state.captionFont)) state.captionFont = defaults.captionFont;
  if (state.bgImage === OLD_BUNDLED_ARTWORK) state.bgImage = BUNDLED_ARTWORK;
  const bundledImages = {bgImage: BUNDLED_ARTWORK, logoImage: BUNDLED_LOGO};
  for (const key of ["bgImage", "outerImage", "logoImage", "characterImage"]) {
    const value = state[key];
    if (typeof value !== "string" || (value !== bundledImages[key] && !/^data:image\//.test(value))) state[key] = null;
  }
  if (state.model === "custom" && !state.characterImage) state.model = "shroom";
  state.characterName ||= "Custom character";
}

$('resetEffect').onclick=()=>{for(const id of ['weatherType','weatherLayer','weatherDensity','weatherSpeed','weatherWind','burnOrigin','burnIntensity','burnSmoke','burnEmbers','emberAmount'])state[id]=defaults[id];t=0;sync();toast('Effect settings reset.')};

$("safe-zone").onchange = () => { $("safe-zone-guide").hidden = !$("safe-zone").checked; };
function restartPreview() {
  t = 0;
  last = 0;
  requestPreview();
}

function selectGalleryCharacter(entry) {
  orbit = tilt = 0;
  state.characterName = entry.name;
  state.model = entry.custom ? "custom" : entry.id;
  state.characterImage = entry.custom ? entry.src : null;
  characterUpload = loadImage(state.characterImage);
  restartPreview();
  sync();
}

let exportSymbolsReady = false;
async function prepareExportSymbols() {
  if (exportSymbolsReady) return;
  await document.fonts.load('14px "Noto Emoji"', "🍄");
  if (!document.fonts.check('14px "Noto Emoji"', "🍄")) return;
  exportSymbolsReady = true;
  captionLayout = null;
  requestPreview();
}

initCharacterGallery();
initEmojiPicker();
initMarketing();
initSocialPublishing();
prepareExportSymbols().catch(() => {});
sync();

export {$, toast, sync, isCharacterModel, selectGalleryCharacter, BUNDLED_ARTWORK, BUNDLED_LOGO,
  artworkRect, paletteTheme, rounded, text, coverImage, paintArtwork, drawCaption, restoreCustomAssets, restartPreview,
  requestPreview, prepareExportSymbols, renderAnimation, renderRevision};
