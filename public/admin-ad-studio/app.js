'use strict';
const $=id=>document.getElementById(id), canvas=$('scene');let ctx=canvas.getContext('2d');const subjectLayer=document.createElement('canvas');
let state={layout:'popout',model:'sir-shroomalot',motion:'none',showCharacter:false,brand:'Pixel Shroom Studio',headline:'Art that breaks the frame.',captionFont:'Arial',captionFontSize:28,captionWeight:'700',captionAlign:'left',socialTitle:'',socialCaption:'',youtubePrivacy:'public',pinterestBoard:'',aiGenerated:true,cta:'Explore the collection ↗',website:'pixelshroomstudio.com',accent:'#b8ff65',platform:'Instagram',background:'dark',depth:100,size:90,duration:6,ratio:'portrait',shadows:true,characterImage:null,bgImage:null,outerImage:null,logoImage:null,bgColor:'#203b30',outerColor:'#12221e',cardColor:'#fcfcfa',textColor:'#203a2b',bgZoom:100,bgX:50,bgY:50,bgDim:15,bgBlur:0,bgMode:'preset',outerMode:'color',subjectX:0,subjectY:0,characterName:'Sir Shroomalot',weatherType:'snow',weatherLayer:'both',weatherDensity:65,weatherSpeed:100,weatherWind:15,burnOrigin:'bottom',burnIntensity:65,burnSmoke:true,burnEmbers:true,emberAmount:45},t=0,playing=true,last=0,orbit=0,tilt=0,drag=null,recording=false;
const PLAYBACK_RATE = .5;
const BUNDLED_ARTWORK = "/assets/campaigns/orbit-roast.webp";
const BUNDLED_LOGO = "/assets/pixel-shroom-logo-128.webp";
const marketingColors = {outerColor: "marketingCanvasColor", cardColor: "marketingPostColor", textColor: "marketingTextColor"};
Object.assign(state, {marketingCanvasColor: "#100e15", marketingPostColor: "#21162f", marketingTextColor: "#f8f4ff"});

function colorKey(id) {
  return state.layout === "marketing" && Object.hasOwn(marketingColors, id) ? marketingColors[id] : id;
}
const defaults=JSON.parse(JSON.stringify(state));
function toast(s){$('toast').textContent=s;$('toast').style.display='block';setTimeout(()=>$('toast').style.display='none',3500)}
function rounded(x,y,w,h,r,fill){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill()}
function text(s,x,y,size,color='#fff',weight=500,family='sans-serif',maxWidth=0){ctx.fillStyle=color;ctx.font=`${weight} ${size}px "${family}", sans-serif`;while(maxWidth&&size>8&&ctx.measureText(s).width>maxWidth){size--;ctx.font=`${weight} ${size}px "${family}", sans-serif`}ctx.fillText(s,x,y)}
function lines(s,x,y,max,size,color){ctx.font=`700 ${size}px sans-serif`;let line='',n=0;for(const word of s.split(' ')){if(ctx.measureText(line+word).width>max&&line){text(line,x,y+n*size*1.16,size,color,700);line='';n++}line+=word+' '}text(line,x,y+n*size*1.16,size,color,700)}
function drawCaption(s,x,y,w,h){let size=Number(s.captionFontSize)||28,wrapped=[];const family=s.captionFont||'Arial',weight=s.captionWeight||'700';function wrap(){ctx.font=`${weight} ${size}px "${family}", sans-serif`;const rows=[];for(const paragraph of String(s.headline).split('\n')){let line='';for(const word of paragraph.split(/\s+/)){if(!word)continue;const next=line?line+' '+word:word;if(ctx.measureText(next).width<=w){line=next;continue}if(line){rows.push(line);line=''}let part='';for(const char of word){if(ctx.measureText(part+char).width>w&&part){rows.push(part);part=''}part+=char}line=part}rows.push(line)}return rows}while(size>=6){wrapped=wrap();if(wrapped.length*size*1.22<=h||size===6)break;size--}ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.textAlign=s.captionAlign||'left';const anchor=s.captionAlign==='center'?x+w/2:s.captionAlign==='right'?x+w:x;for(let i=0;i<wrapped.length;i++)text(wrapped[i],anchor,y+size+i*size*1.22,size,s.textColor,weight,family);ctx.restore();$('captionFit').textContent=size<Number(s.captionFontSize)?'Caption fitted to '+size+'px on the ad. Shorten it for larger text.':'Caption uses '+size+'px on the ad.'}
const characters={};
for(const entry of CHARACTER_CATALOG){const img=new Image();img.src=entry.src;characters[entry.id]=img;}
const isCharacterModel=model=>model==='custom'||Object.hasOwn(characters,model);
let characterUpload=null,backdrop=null,outerBackdrop=null,brandLogo=null;
let characterHitArea = null;
const extraControls = [
  "captionFont", "captionFontSize", "captionWeight", "captionAlign", "bgColor", "outerColor", "cardColor", "textColor",
  "bgZoom", "bgX", "bgY", "bgDim", "bgBlur", "bgMode", "outerMode", "weatherType", "weatherLayer",
  "weatherDensity", "weatherSpeed", "weatherWind", "burnOrigin", "burnIntensity", "burnSmoke", "burnEmbers", "emberAmount"
];
function coverImage(img,x,y,w,h,zoom=100,fx=50,fy=50){const k=Math.max(w/img.naturalWidth,h/img.naturalHeight)*zoom/100,dw=img.naturalWidth*k,dh=img.naturalHeight*k;ctx.drawImage(img,x+(w-dw)*fx/100,y+(h-dh)*fy/100,dw,dh)}

function paintCanvas(height) {
  ctx.fillStyle = state[colorKey("outerColor")];
  ctx.fillRect(0, 0, 864, height);
  if (state.outerMode === "image" && outerBackdrop?.complete && outerBackdrop.naturalWidth) {
    coverImage(outerBackdrop, 0, 0, 864, height);
  }
}

function paintArtwork(x, y, width, height, zoom = Number(state.bgZoom)) {
  if (state.bgMode === "color") {
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(x, y, width, height);
  } else if (state.bgMode === "image" && backdrop?.complete && backdrop.naturalWidth) {
    ctx.save();
    ctx.filter = `blur(${state.bgBlur}px)`;
    coverImage(backdrop, x, y, width, height, zoom, Number(state.bgX), Number(state.bgY));
    ctx.restore();
    ctx.fillStyle = `rgba(0,0,0,${Number(state.bgDim) / 100})`;
    ctx.fillRect(x, y, width, height);
  }
}

const canvasHeights = {square: 864, story: 1536, portrait: 1080};
const hasCharacter = () => state.layout === "popout" || state.showCharacter;
const characterImage = () => state.model === "custom" ? characterUpload : characters[state.model];

function artworkRect(height) {
  const marketing = state.layout === "marketing";
  const y = marketing ? 132 : 172;
  const h = marketing ? Math.min(height * .48, height - 425) : Math.min(440, height * .36);
  return {x: marketing ? 56 : 122, y, w: marketing ? 752 : 620, h, edge: y + h};
}

function characterCenterY(rect) {
  return Math.round(rect.y + rect.h * .49);
}

function syncPlacement(x = state.subjectX, y = state.subjectY) {
  const height = canvas.height;
  const anchorY = characterCenterY(artworkRect(height));
  state.subjectX = Math.round(Math.max(-432, Math.min(432, Number(x) || 0)));
  state.subjectY = Math.round(Math.max(-anchorY, Math.min(height - anchorY, Number(y) || 0)));
  $("subjectY").min = -anchorY;
  $("subjectY").max = height - anchorY;
  $("subjectX").value = state.subjectX;
  $("subjectY").value = state.subjectY;
  $("subjectXOut").value = Math.round((432 + state.subjectX) / 864 * 100) + "%";
  $("subjectYOut").value = Math.round((anchorY + state.subjectY) / height * 100) + "%";
  $("sizeOut").value = state.size + "%";
}

function paintCharacter(rect, height) {
  characterHitArea = null;
  if (state.motion !== "none") SceneEffects.before(ctx, state, t, rect);
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
    if (effects && (subjectLayer.width !== 864 || subjectLayer.height !== height)) {
      subjectLayer.width = 864;
      subjectLayer.height = height;
    }
    const layer = effects ? subjectLayer.getContext("2d") : ctx;
    if (effects) layer.clearRect(0, 0, 864, height);
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

function draw(){const W=canvas.width,H=canvas.height,s=W/864;ctx.setTransform(s,0,0,s,0,0);const h=H/s;
paintCanvas(h);
if(state.layout==='marketing'&&typeof renderMarketingAd==='function'){
  renderMarketingAd(ctx,state,t,h,brandLogo);
  paintCharacter(artworkRect(h), h);
  updatePlaybackClock();
  return;
}
const light=state.background==='light',bg=state.background==='purple'?'#251631':light?'#e7ebe5':'#12221e';
const px=104,pw=656,py=62,ph=h-124;
const rect=artworkRect(h),{x:mediaX,y:mediaY,w:mediaW,h:mediaH,edge}=rect;
ctx.save();ctx.shadowColor='#0005';ctx.shadowBlur=28;ctx.shadowOffsetY=12;rounded(px,py,pw,ph,18,state.cardColor);ctx.restore();
if(brandLogo?.complete&&brandLogo.naturalWidth){ctx.save();ctx.beginPath();ctx.arc(px+51,py+53,25,0,Math.PI*2);ctx.clip();coverImage(brandLogo,px+26,py+28,50,50);ctx.restore()}text(state.brand,brandLogo?.complete&&brandLogo.naturalWidth?px+91:px+29,py+47,22,state.textColor,700,state.captionFont,pw-156);text(state.platform+' · Sponsored',brandLogo?.complete&&brandLogo.naturalWidth?px+91:px+29,py+73,15,'#758176');text('•••',px+pw-60,py+55,25,'#49554c');
ctx.save();ctx.beginPath();ctx.roundRect(mediaX,mediaY,mediaW,mediaH,5);ctx.clip();let grad=ctx.createLinearGradient(mediaX,mediaY,mediaX,edge);grad.addColorStop(0,bg);grad.addColorStop(1,state.background==='purple'?'#5a3467':light?'#718b6b':'#3b5941');ctx.fillStyle=grad;ctx.fillRect(mediaX,mediaY,mediaW,mediaH);
const glow=ctx.createRadialGradient(432,mediaY+mediaH*.55,5,432,mediaY+mediaH*.55,300);glow.addColorStop(0,'#b8ff6528');glow.addColorStop(1,'#b8ff6500');ctx.fillStyle=glow;ctx.fillRect(mediaX,mediaY,mediaW,mediaH);ctx.strokeStyle='#b3d69720';for(let k=0;k<10;k++){ctx.beginPath();ctx.ellipse(432,edge+60,80+k*45,20+k*35,0,0,Math.PI*2);ctx.stroke()}paintArtwork(mediaX, mediaY, mediaW, mediaH);ctx.restore();
// The post UI is drawn BEFORE the foreground subject so the breakout can occlude it.
text('♡   ◯   ↗',px+29,edge+44,30,'#26372c');text('⌑',px+pw-51,edge+44,30,'#26372c');text('1,248 likes',px+29,edge+75,14,'#384b3c',700);
const copyY=Math.max(edge+145,h-300);drawCaption(state,px+30,copyY,pw-60,h-191-copyY);rounded(px+28,h-171,pw-56,55,8,'#1d3024');text(state.cta,px+49,h-136,20,'#fff',700,state.captionFont,pw-100);text(state.website,px+30,h-88,15,state.textColor,400,state.captionFont,pw-60);paintCharacter(rect,h);updatePlaybackClock();}
function updatePlaybackClock() {
  $('time').textContent=(t/PLAYBACK_RATE).toFixed(1)+' / '+(Number(state.duration)/PLAYBACK_RATE).toFixed(1)+'s';
  $('seek').value=t/PLAYBACK_RATE;
}


function frame(now){if(last&&playing&&!recording&&!drag)t=(t+(now-last)/1000*PLAYBACK_RATE)%Number(state.duration);last=now;if(!recording)draw();requestAnimationFrame(frame)}requestAnimationFrame(frame);
const regularControls = ["brand", "headline", "cta", "website", "platform", "background", "depth", "size", "duration", "ratio", "shadows", "showCharacter"];

function sync() {
  document.body.dataset.adLayout = state.layout;
  $("creative-layout").value = state.layout;
  if (typeof syncSocialCopy === "function") syncSocialCopy();
  FontLibrary.sync({...state, cardColor: state[colorKey("cardColor")], textColor: state[colorKey("textColor")]});

  const isPopout = state.layout === "popout";
  const visible = hasCharacter();
  $("characterSection").hidden = $("character-placement").hidden = $("character-stage-note").hidden = !visible;
  $("depth-setting").hidden = state.motion === "none";
  canvas.classList.toggle("character-visible", visible);
  if (typeof updateCharacterSelection === "function") updateCharacterSelection();

  $("artwork-title").textContent = isPopout ? "Scene background" : "Campaign artwork";
  $("background").closest("label").hidden = state.bgMode !== "preset";
  $("bgColor").closest("label").hidden = state.bgMode !== "color";
  $("bgAdjust").hidden = state.bgMode !== "image" || !state.bgImage;
  $("clearBg").hidden = !state.bgImage;
  $("outerColor").closest("label").hidden = state.outerMode === "image" && !!state.outerImage;
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
    const value = state[colorKey(id)];
    if (input.type === "checkbox") input.checked = value;
    else input.value = id === "duration" ? Number(value) / PLAYBACK_RATE : value;
  }
  $("depthOut").value = state.depth + "%";
  $("durationOut").value = Number(state.duration) / PLAYBACK_RATE + "s";
  $("seek").max = Number(state.duration) / PLAYBACK_RATE;
  const height = canvasHeights[state.ratio];
  if (canvas.height !== height) canvas.height = height;
  syncPlacement();
  for (const button of document.querySelectorAll("[data-motion]")) {
    const selected = button.dataset.motion === state.motion;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", selected);
  }
}

for (const id of [...regularControls, ...extraControls]) {
  $(id).addEventListener("input", (event) => {
    const input = event.currentTarget;
    state[colorKey(id)] = id === "duration" ? Number(input.value) * PLAYBACK_RATE :
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
  });
}

function setPlaying(value) {
  playing = value;
  $("play").textContent = playing ? "Ⅱ" : "▶";
  $("play").setAttribute("aria-label", playing ? "Pause preview" : "Play preview");
}

$("play").onclick = () => { if (!recording) setPlaying(!playing); };
$("restart").onclick = () => { if (!recording) t = 0; };
$("seek").oninput = () => {
  if (recording) return;
  t = Number($("seek").value) * PLAYBACK_RATE;
  setPlaying(false);
};

canvas.onpointerdown = (event) => {
  if (!hasCharacter() || recording || !event.isPrimary || event.button !== 0 || !characterHitArea) return;
  const bounds = canvas.getBoundingClientRect();
  const sx = canvas.width / bounds.width, sy = canvas.height / bounds.height;
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
};
function download(blob,name){let url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
$("save").onclick = () => {
  const project = JSON.stringify({...state, orbit, tilt}, null, 2);
  download(new Blob([project], {type: "application/json"}), state.layout === "marketing" ? "campaign-project.json" : "popout-project.json");
  try { localStorage.setItem("popout", project); } catch {}
  toast("Project downloaded as JSON.");
};
$("load").onclick = () => { if (!recording) $("projectFile").click(); };
$("projectFile").onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || recording) return;
  try {
    const data = JSON.parse(await file.text());
    const oldProduct = ["canvas", "box"].includes(data?.model);
    const oldMotions = {zoom: "weather", portal: "weather", "page-peel": "melt", lava: "melt"};
    if ((!isCharacterModel(data?.model) && !oldProduct) ||
        (!MOTION_PRESETS.some(({id}) => id === data.motion) && !Object.hasOwn(oldMotions, data.motion))) throw Error();
    state = {...defaults};
    for (const key of Object.keys(state)) if (Object.hasOwn(data, key)) state[key] = data[key];
    if (oldProduct) {
      state.model = "shroom";
      state.characterImage = null;
      const photo = data.faceImages?.front || data.image;
      if (!state.bgImage && typeof photo === "string" && /^data:image\//.test(photo)) {
        state.bgImage = photo;
        state.bgMode = "image";
      }
    }
    if (Object.hasOwn(oldMotions, state.motion)) state.motion = oldMotions[state.motion];
    if (state.weatherType === "embers") {
      state.motion = "page-burn";
      state.burnEmbers = true;
      state.weatherType = "snow";
    }
    sanitizeProject();
    orbit = Number.isFinite(Number(data.orbit)) ? Number(data.orbit) : 0;
    tilt = Math.max(-.8, Math.min(.8, Number(data.tilt) || 0));
    restoreCustomAssets();
    characterUpload = loadImage(state.characterImage);
    t = 0;
    sync();
    toast(oldProduct ? "Project opened as a character ad." : "Project opened.");
  } catch {
    toast("Please select a valid AD Studio project JSON.");
  }
};
$('snapshot').onclick=()=>{if(!assetsReady())return toast('Wait for your images and selected font to load.');draw();canvas.toBlob(b=>download(b,state.layout==='marketing'?'campaign-ad.png':'popout-frame.png'),'image/png')};
async function renderAnimation(onProgress=()=>{}){if(recording)throw Error('Already recording.');if(!assetsReady())throw Error('Wait for your images and selected font to load.');if(!canvas.captureStream||!window.MediaRecorder)throw Error('Video recording is unavailable in this browser.');const mime=['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(m=>MediaRecorder.isTypeSupported(m));if(!mime)throw Error('No supported video encoder.');return new Promise((resolve,reject)=>{const previous=playing,oldTime=t,stream=canvas.captureStream(30),chunks=[];let rec,finished=false;const restore=()=>{if(finished)return;finished=true;stream.getTracks().forEach(x=>x.stop());recording=false;playing=previous;t=oldTime;$('editorPage').inert=false;$('export').disabled=false;$('export').textContent='Export video ↗';last=0};try{rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:8000000})}catch{stream.getTracks().forEach(x=>x.stop());return reject(Error('Could not start video encoder.'))}recording=true;playing=false;t=0;$('editorPage').inert=true;$('export').disabled=true;$('export').textContent='Recording…';rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};rec.onerror=()=>{restore();reject(Error('Video recording failed.'))};rec.onstop=()=>{const blob=new Blob(chunks,{type:mime.split(';')[0]});restore();blob.size?resolve(blob):reject(Error('Empty video.'))};draw();rec.start();const start=performance.now();function tick(now){if(finished)return;t=Math.min(Number(state.duration),(now-start)/1000*PLAYBACK_RATE);draw();onProgress(t/Number(state.duration));t>=Number(state.duration)?rec.stop():requestAnimationFrame(tick)}requestAnimationFrame(tick)})}
$('export').onclick=async()=>{try{const blob=await renderAnimation();download(blob,(state.layout==='marketing'?'campaign-ad.':'popout-ad.')+(blob.type.includes('mp4')?'mp4':'webm'));toast('Video downloaded.')}catch(error){toast(error.message)}};

sync();

function assetsReady() {
  if (!FontLibrary.ready(state.captionFont)) return false;
  const images = [brandLogo];
  if (state.bgMode === "image") images.push(backdrop);
  if (state.outerMode === "image") images.push(outerBackdrop);
  if (hasCharacter()) images.push(characterImage());
  return images.filter(Boolean).every((image) => image.complete && image.naturalWidth > 0);
}
$('characterUpload').onchange=e=>{const file=e.target.files[0];if(!file)return;if(file.size>12*1024*1024)return toast('Choose an image under 12 MB.');const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{characterUpload=img;state.characterImage=reader.result;state.model='custom';state.characterName=file.name.replace(/\.[^.]+$/,'');sync();toast('Character loaded. Name it and save it to your character collection.')};img.onerror=()=>toast('This image could not be loaded.');img.src=reader.result};reader.readAsDataURL(file)};

function loadImage(source) {
  if (!source) return null;
  const image = new Image();
  image.src = source;
  return image;
}

function restoreCustomAssets() {
  for (const id of ["bgUpload", "outerUpload", "logoUpload"]) $(id).value = "";
  backdrop = loadImage(state.bgImage);
  outerBackdrop = loadImage(state.outerImage);
  brandLogo = loadImage(state.logoImage);
}
function uploadAsset(id,key,setter){$(id).onchange=e=>{const file=e.target.files[0];if(!file)return;if(file.size>12*1024*1024)return toast('Choose an image under 12 MB.');const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{state[key]=reader.result;setter(img);sync();toast('Image updated.')};img.onerror=()=>toast('This image could not be loaded.');img.src=reader.result};reader.readAsDataURL(file)}}
uploadAsset('bgUpload','bgImage',img=>{backdrop=img;state.bgMode='image'});uploadAsset('outerUpload','outerImage',img=>{outerBackdrop=img;state.outerMode='image'});uploadAsset('logoUpload','logoImage',img=>brandLogo=img);
$('clearBg').onclick=()=>{state.bgImage=null;backdrop=null;state.bgMode='preset';$('bgUpload').value='';sync()};$('clearOuter').onclick=()=>{state.outerImage=null;outerBackdrop=null;state.outerMode='color';$('outerUpload').value='';sync()};$('clearLogo').onclick=()=>{state.logoImage=null;brandLogo=null;$('logoUpload').value='';sync()};
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
  for (const key of ["bgColor", "outerColor", "cardColor", "textColor", "accent", ...Object.values(marketingColors)]) {
    if (!/^#[0-9a-f]{6}$/i.test(state[key])) state[key] = defaults[key];
  }
  const options = {
    layout: ["marketing", "popout"], ratio: Object.keys(canvasHeights), background: ["dark", "purple", "light"],
    platform: ["Instagram", "Facebook", "TikTok"], captionAlign: ["left", "center", "right"], captionWeight: ["400", "700"],
    youtubePrivacy: ["public", "unlisted", "private"], weatherType: ["snow", "rain", "storm", "petals", "confetti"],
    weatherLayer: ["behind", "front", "both"], burnOrigin: ["bottom", "center"],
    bgMode: ["preset", "color", "image"], outerMode: ["color", "image"]
  };
  state.captionWeight = String(state.captionWeight);
  for (const [key, values] of Object.entries(options)) if (!values.includes(state[key])) state[key] = defaults[key];
  if (!FontLibrary.valid(state.captionFont)) state.captionFont = defaults.captionFont;
  const bundledImages = {bgImage: BUNDLED_ARTWORK, logoImage: BUNDLED_LOGO};
  for (const key of ["bgImage", "outerImage", "logoImage", "characterImage"]) {
    const value = state[key];
    if (typeof value !== "string" || (value !== bundledImages[key] && !/^data:image\//.test(value))) state[key] = null;
  }
  if (state.model === "custom" && !state.characterImage) state.model = "shroom";
  state.characterName ||= "Custom character";
}

$('resetEffect').onclick=()=>{for(const id of ['weatherType','weatherLayer','weatherDensity','weatherSpeed','weatherWind','burnOrigin','burnIntensity','burnSmoke','burnEmbers','emberAmount'])state[id]=defaults[id];t=0;sync();toast('Effect settings reset.')};
