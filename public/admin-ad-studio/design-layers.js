import {maskPolygon, tracePts, MASK_SHAPES} from "./canvix/shapes.ts";
import {fitFontSize, wrapLines} from "./canvix/text-fit.ts";
import {animateElementAt} from "./canvix/element-animation.ts";

const WIDTH = 864, LIMIT = 24;
const fonts = ["Arial", "Georgia", "Impact", "Trebuchet MS", "Comic Sans MS", "Courier New"];
const animations = ["none", "fade", "rise", "pop", "zoom", "rotate", "breathe", "wipe"];
const clamp = (v, min, max, fallback) => Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback;
const color = (v, fallback) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
const imageData = v => typeof v === "string" && v.length <= 8_000_000 && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(v) ? v : "";
const id = () => crypto.randomUUID();
export function sanitizeLayers(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input.slice(0, LIMIT).filter(l => l && ["text", "shape", "image"].includes(l.type)).map(l => {
    let key = typeof l.id === "string" && /^[a-z0-9-]{1,64}$/i.test(l.id) ? l.id : id();
    if (seen.has(key)) key = id();
    seen.add(key);
    return {id:key, type:l.type, name:String(l.name || l.type).slice(0,64),
      x:clamp(l.x,0,1,.15), y:clamp(l.y,0,1,.15), w:clamp(l.w,.04,1,.7), h:clamp(l.h,.03,1,.14),
      color:color(l.color,"#ffffff"), opacity:clamp(l.opacity,0,1,1), rotation:clamp(l.rotation,-180,180,0),
      text:String(l.text ?? "").slice(0,600), font:fonts.includes(l.font) ? l.font : "Arial",
      fontSize:clamp(l.fontSize,12,160,48), bold:l.bold !== false,
      shape:MASK_SHAPES.includes(l.shape) ? l.shape : "rounded",
      animation:animations.includes(l.animation) ? l.animation : "none",
      hidden:l.hidden === true, image:l.type === "image" ? imageData(l.image) : ""};
  }).filter(l => l.type !== "image" || l.image);
}

export function createDesignLayers({getLayers, setLayers, canvas, getHeight, getPalette, prepareImage, requestPreview, toast}) {
  let selected = null, undo = [], redo = [], current = null, drag = null;
  const $ = id => document.getElementById(id);
  const list = $("design-layer-list"), form = $("design-layer-properties");
  const cache = new Map();
  const getImage = source => {
    if (!cache.has(source)) {
      const i = new Image();
      i.onload = requestPreview;
      i.onerror = requestPreview;
      i.src = source;
      cache.set(source,i);
      if (cache.size > 48) cache.delete(cache.keys().next().value);
    }
    return cache.get(source);
  };
  const read = () => getLayers() || [];
  const active = () => read().find(l => l.id === selected);
  const shapeName = l => l.type === "shape" ? l.shape : l.type;
  const status = message => { $("design-layer-status").textContent = message; };
  const history = previous => { undo.push(previous); if (undo.length > 30) undo.shift(); redo = []; };
  function update(next, {remember=true, refresh=true}={}) {
    if (remember) history(read());
    current = next;
    setLayers(next);
    if (refresh) sync();
    else updateHistory();
  }
  function updateHistory() {
    $("design-undo").disabled = !undo.length;
    $("design-redo").disabled = !redo.length;
  }
  function sync() {
    const layers = read();
    // Project loads replace the array outside the layer adapter.
    if (current !== layers) { undo = []; redo = []; selected = null; current = layers; }
    if (!layers.some(l => l.id === selected)) selected = null;
    list.replaceChildren();
    for (const l of [...layers].reverse()) {
      const row = document.createElement("button");
      row.type = "button"; row.className = "design-layer-row";
      row.setAttribute("aria-pressed", String(l.id === selected));
      row.classList.toggle("selected",l.id === selected);
      const mark = document.createElement("span"); mark.className = "layer-swatch";
      mark.style.backgroundColor = l.color; mark.textContent = l.type === "text" ? "T" : l.type === "image" ? "I" : "";
      const name = document.createElement("span");
      const title = document.createElement("strong"); title.textContent = l.name;
      const subtitle = document.createElement("small"); subtitle.textContent = shapeName(l)+(l.hidden?" · hidden":"");
      name.append(title,subtitle); row.append(mark,name);
      row.onclick = () => {selected=l.id; sync();};
      list.append(row);
    }
    $("design-layer-empty").hidden = !!layers.length;
    $("design-layer-count").textContent = layers.length + " / " + LIMIT;
    canvas.classList.toggle("design-layer-drag", layers.some(l=>!l.hidden));
    const l = active(); form.hidden = !l;
    if (l) {
      for (const field of ["name","text","font","fontSize","shape","color","opacity","x","y","w","h","rotation","animation","bold","hidden"]) {
        const input = $("layer-"+field);
        if (input.type === "checkbox") input.checked = l[field];
        else input.value = ["x","y","w","h","opacity"].includes(field) ? Math.round(l[field]*100) : l[field];
      }
      $("layer-text-controls").hidden = l.type !== "text";
      $("layer-shape-control").hidden = l.type === "text";
      $("layer-color-control").hidden = l.type === "image";
      const i = layers.indexOf(l);
      $("layer-forward").disabled = i === layers.length-1;
      $("layer-backward").disabled = i === 0;
    }
    updateHistory();
  }
  function add(type, extra={}) {
    const layers=read();
    if (layers.length >= LIMIT) return status("Layer limit reached. Remove a layer first.");
    const l=sanitizeLayers([{id:id(), type, name:type === "text" ? "Headline" : type === "shape" ? "Shape" : "Artwork", text:"Your headline",
      color:type === "shape" ? getPalette().button : "#ffffff", w:type==="shape"?.3:.7, h:type==="shape"?.18:.14, ...extra}])[0];
    if (!l) return;
    selected=l.id; update([...layers,l]); status("Layer added. Drag it on the canvas or use the position fields.");
  }
  $("design-add-text").onclick=()=>add("text");
  $("design-add-shape").onclick=()=>add("shape",{shape:"rounded"});
  $("design-add-image").onchange=async event=>{
    const input=event.currentTarget, file=input.files[0], project=read();
    if (!file) return;
    try {
      const {data,source}=await prepareImage(file);
      if (read()!==project) return;
      const w=.6, h=Math.min(.7,w*WIDTH/getHeight()*source.naturalHeight/source.naturalWidth);
      add("image",{image:data,name:file.name.slice(0,64),w,h,shape:"none"});
    } catch(error){toast(error.message || "Image could not be loaded.");}
    finally{input.value="";}
  };
  for (const field of ["name","text","font","fontSize","shape","color","opacity","x","y","w","h","rotation","animation","bold","hidden"]) {
    const input=$("layer-"+field);
    input.addEventListener("change",()=>{
      const l=active(); if (!l) return;
      const v=input.type==="checkbox"?input.checked:["x","y","w","h","opacity"].includes(field)?Number(input.value)/100:input.value;
      const next=sanitizeLayers(read().map(item=>item.id===selected?{...item,[field]:v}:item));
      update(next);
    });
  }
  function move(step) {
    const next=[...read()], i=next.findIndex(l=>l.id===selected), j=i+step;
    if (i<0||j<0||j>=next.length) return;
    [next[i],next[j]]=[next[j],next[i]]; update(next);
  }
  $("layer-forward").onclick=()=>move(1);
  $("layer-backward").onclick=()=>move(-1);
  $("layer-delete").onclick=()=>{update(read().filter(l=>l.id!==selected));status("Layer removed.");};
  $("layer-duplicate").onclick=()=>{const l=active();if(l)add(l.type,{...l,id:id(),name:l.name+" copy",x:Math.min(.95,l.x+.03),y:Math.min(.95,l.y+.03)});};
  $("design-undo").onclick=()=>{if(!undo.length)return;redo.push(read());update(undo.pop(),{remember:false});};
  $("design-redo").onclick=()=>{if(!redo.length)return;undo.push(read());update(redo.pop(),{remember:false});};
  const box=l=>({x:l.x*WIDTH,y:l.y*getHeight(),w:l.w*WIDTH,h:l.h*getHeight()});
  function paint(ctx,height,time) {
    for(const l of read()){
      if(l.hidden)continue;
      const {x,y,w,h}= {x:l.x*WIDTH,y:l.y*height,w:l.w*WIDTH,h:l.h*height};
      const a=animateElementAt({width:w,height:h,animation:{kind:l.animation,duration:1.2,easing:"easeOut"}},time);
      ctx.save();
      ctx.globalAlpha=l.opacity*a.opacity;
      ctx.translate(x+w/2+a.dx,y+h/2+a.dy);
      ctx.rotate((l.rotation+a.rotation)*Math.PI/180);
      ctx.scale(a.scaleX,a.scaleY); ctx.translate(-w/2,-h/2);
      ctx.beginPath();ctx.rect(0,0,w*a.reveal,h);ctx.clip();
      if(l.type==="text"){
        const style={text:l.text,fontFamily:l.font,bold:l.bold,italic:false,letterSpacing:0,lineHeight:1.18,fontSize:l.fontSize};
        const measure=(text,s)=>{ctx.font=(s.bold?"700 ":"400 ")+s.fontSize+'px "'+s.fontFamily+'"';return ctx.measureText(text).width;};
        const fs=fitFontSize(style,{width:w,height:h},measure);
        const s={...style,fontSize:fs}; const rows=wrapLines(l.text,w,s,measure);
        ctx.font=(l.bold?"700 ":"400 ")+fs+'px "'+l.font+'"';ctx.fillStyle=l.color;ctx.textAlign="left";ctx.textBaseline="top";
        for(let i=0;i<rows.length;i++)ctx.fillText(rows[i],0,i*fs*s.lineHeight,w);
      }else{
        const points=maskPolygon(l.shape);
        if(points){tracePts(ctx,points,w,h);ctx.clip();}
        if(l.type==="shape"){ctx.fillStyle=l.color;ctx.fillRect(0,0,w,h);}
        else {const i=getImage(l.image);if(i.complete&&i.naturalWidth){const scale=Math.min(w/i.naturalWidth,h/i.naturalHeight);const dw=i.naturalWidth*scale,dh=i.naturalHeight*scale;ctx.drawImage(i,(w-dw)/2,(h-dh)/2,dw,dh);}}
      }
      ctx.restore();
    }
  }
  function point(event){const r=canvas.getBoundingClientRect();return {x:(event.clientX-r.left)*WIDTH/r.width,y:(event.clientY-r.top)*getHeight()/r.height};}
  function start(event) {
    const p=point(event); const l=[...read()].reverse().find(l=>{
      if(l.hidden)return false;const b=box(l),r=-l.rotation*Math.PI/180,dx=p.x-b.x-b.w/2,dy=p.y-b.y-b.h/2;
      return Math.abs(dx*Math.cos(r)-dy*Math.sin(r))<=b.w/2&&Math.abs(dx*Math.sin(r)+dy*Math.cos(r))<=b.h/2;
    });
    if(!l)return false;
    selected=l.id;sync();drag={pointer:event.pointerId,p,l,previous:read(),moved:false};canvas.setPointerCapture(event.pointerId);return true;
  }
  function dragMove(event){
    if(drag?.pointer!==event.pointerId)return false;
    const p=point(event),l=drag.l;
    if(!drag.moved){history(drag.previous);drag.moved=true;}
    update(read().map(i=>i.id===l.id?{...i,x:clamp(l.x+(p.x-drag.p.x)/WIDTH,0,1-l.w,l.x),y:clamp(l.y+(p.y-drag.p.y)/getHeight(),0,1-l.h,l.y)}:i),{remember:false,refresh:false});return true;
  }
  function end(){if(!drag)return false;drag=null;sync();return true;}
  return {sync,paint,start,dragMove,end,hasAnimation:()=>read().some(l=>!l.hidden&&l.animation!=="none"),ready:()=>read().filter(l=>l.type==="image"&&!l.hidden).every(l=>{const i=getImage(l.image);return i.complete&&i.naturalWidth>0;})};
}
