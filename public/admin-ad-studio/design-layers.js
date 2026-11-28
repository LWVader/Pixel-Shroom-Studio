import {maskPolygon, tracePts, MASK_SHAPES,starPointsEx,stretchPts} from "./canvix/shapes.ts";
import {fitFontSize, wrapLines} from "./canvix/text-fit.ts";
import {animateElementAt} from "./canvix/element-animation.ts";

const WIDTH = 864, LIMIT = 64;
const fonts = ["Arial","Georgia","Impact","Trebuchet MS","Comic Sans MS","Courier New","Noto Emoji"];
const safeFont = v => typeof v==="string" && /^[a-z0-9 -]{1,70}$/i.test(v) ? v : "Arial";
const animations = ["none", "fade", "rise", "pop", "zoom", "rotate", "breathe", "wipe"];
const clamp = (v, min, max, fallback) => Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback;
export const safeColor=(v,fallback="#ffffff")=>typeof v==="string"&&(v==="transparent"||/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v))?v:fallback;
const color=safeColor;
export function safeGradient(g){return g&&typeof g==="object"&&["linear","radial"].includes(g.type)?{type:g.type,from:color(g.from),to:color(g.to),angle:clamp(g.angle,-360,360,0)}:null;}
export function gradientPaint(ctx,g,w,h){const a=g.angle*Math.PI/180, dx=Math.cos(a),dy=Math.sin(a),d=Math.abs(dx)*w+Math.abs(dy)*h;const fill=g.type==="radial"?ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,Math.hypot(w,h)/2):ctx.createLinearGradient(w/2-dx*d/2,h/2-dy*d/2,w/2+dx*d/2,h/2+dy*d/2);fill.addColorStop(0,g.from);fill.addColorStop(1,g.to);return fill;}
const imageData = v => typeof v === "string" && v.length <= 8_000_000 && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(v) ? v : "";
const id = () => crypto.randomUUID();
export function sanitizeLayers(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input.slice(0, LIMIT).filter(l => l && ["text", "shape", "image","line"].includes(l.type)).map(l => {
    let key = typeof l.id === "string" && /^[a-z0-9-]{1,64}$/i.test(l.id) ? l.id : id();
    if (seen.has(key)) key = id();
    seen.add(key);
    return {id:key, type:l.type, name:String(l.name || l.type).slice(0,64),
      x:clamp(l.x,l.template?-2:0,l.template?3:1,.15), y:clamp(l.y,l.template?-2:0,l.template?3:1,.15), w:clamp(l.w,l.template?.0001:.04,l.template?3:1,.7), h:clamp(l.h,l.type==="line"?0:l.template?.0001:.03,l.template?3:1,.14),template:l.template===true,
      color:color(l.color,"#ffffff"), opacity:clamp(l.opacity,0,1,1), rotation:clamp(l.rotation,-180,180,0),
      text:String(l.text ?? "").slice(0,4000),font:safeFont(l.font),
      fontSize:clamp(l.fontSize,l.template?2:12,512,48),bold:l.template?l.bold===true:l.bold!==false,
      italic:l.italic===true,underline:l.underline===true,strike:l.strike===true,align:["left","center","right","justify"].includes(l.align)?l.align:"left",
      autoFit:l.template?l.autoFit===true:l.autoFit!==false,lineHeight:clamp(l.lineHeight,.5,3,1.18),letterSpacing:clamp(l.letterSpacing,-20,40,0),
      shape:[...MASK_SHAPES,"path"].includes(l.shape)?l.shape:l.template?"none":"rounded",
      cornerRadius:clamp(l.cornerRadius,0,500,0),stroke:color(l.stroke,"transparent"),strokeWidth:clamp(l.strokeWidth,0,100,0),
      pathData:typeof l.pathData==="string"&&/^[MLHVCSQTAZmlhvcsqtaz0-9 .,+-]+$/.test(l.pathData)&&l.pathData.length<4000?l.pathData:"",
      gradient:safeGradient(l.gradient),dashed:l.dashed===true,arrowStart:l.arrowStart===true,arrowEnd:l.arrowEnd===true,
      starPoints:clamp(l.starPoints,3,16,5),innerRatio:clamp(l.innerRatio,.15,.85,.55),
      animation:animations.includes(l.animation) ? l.animation : "none",
      hidden:l.hidden === true, image:l.type === "image" ? imageData(l.image) : ""};
  }).filter(l => l.type !== "image" || l.image);
}

export function createDesignLayers({getLayers, setLayers, canvas, getHeight, getPalette, prepareImage, requestPreview, toast, loadFont=()=>Promise.resolve()}) {
  let selected = null, undo = [], redo = [], current = null, drag = null;
  const $ = id => document.getElementById(id);
  const list = $("design-layer-list"), form = $("design-layer-properties");
  const requestedFonts=new Set(fonts);
  function ensureFonts(layers){for(const l of layers)if(l.type==="text"&&!requestedFonts.has(l.font)){requestedFonts.add(l.font);loadFont(l.font).then(requestPreview).catch(()=>{});}}
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
    const layers = read(); ensureFonts(layers);
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
      for (const field of ["name","text","font","fontSize","shape","color","opacity","x","y","w","h","rotation","animation","bold","italic","align","autoFit","stroke","strokeWidth","hidden"]) {
        const input = $("layer-"+field);
        if(field==="font"&&![...input.options].some(o=>o.value===l.font))input.add(new Option(l.font,l.font));
        if (input.type === "checkbox") input.checked = l[field];
        else input.value = ["x","y","w","h","opacity"].includes(field) ? Math.round(l[field]*10000)/100 : ["color","stroke"].includes(field)&&!/^#[0-9a-f]{6}$/i.test(l[field])?"#ffffff":l[field];
      }
      $("layer-text-controls").hidden = l.type !== "text";
      $("layer-shape-control").hidden = l.type === "text" || l.type==="line";
      $("layer-color-control").hidden = l.type === "image" || l.type==="line";
      $("layer-stroke-controls").hidden=!["shape","line"].includes(l.type);
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
  for (const field of ["name","text","font","fontSize","shape","color","opacity","x","y","w","h","rotation","animation","bold","italic","align","autoFit","stroke","strokeWidth","hidden"]) {
    const input=$("layer-"+field);
    input.addEventListener("change",()=>{
      const l=active(); if (!l) return;
      const v=input.type==="checkbox"?input.checked:["x","y","w","h","opacity"].includes(field)?Number(input.value)/100:input.value;
      const next=sanitizeLayers(read().map(item=>item.id===selected?{...item,[field]:v,...(field==="color"?{gradient:null}:{} )}:item));
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
  function paint(ctx,height,time,layers=read()) {
    for(const l of layers){
      if(l.hidden)continue;
      const {x,y,w,h}= {x:l.x*WIDTH,y:l.y*height,w:l.w*WIDTH,h:l.h*height};
      const a=animateElementAt({width:w,height:h,animation:{kind:l.animation,duration:1.2,easing:"easeOut"}},time);
      ctx.save();
      ctx.globalAlpha=l.opacity*a.opacity;
      const centered=!l.template||["circle","star"].includes(l.shape);
      ctx.translate(x+(centered?w/2:0)+a.dx,y+(centered?h/2:0)+a.dy);
      ctx.rotate((l.rotation+a.rotation)*Math.PI/180);
      ctx.scale(a.scaleX,a.scaleY);if(centered)ctx.translate(-w/2,-h/2);
      if(l.type!=="line"&&(l.type!=="shape"||a.reveal!==1)){ctx.beginPath();ctx.rect(0,0,w*a.reveal,h);ctx.clip();}
      if(l.type==="text"){
        const fontFamily=l.font==="Noto Emoji"?'Noto Emoji':l.font;
        const style={text:l.text,fontFamily,bold:l.bold,italic:l.italic,letterSpacing:l.letterSpacing,lineHeight:l.lineHeight,fontSize:l.fontSize};
        const face=s=>(s.italic?"italic ":"")+(s.bold?"700 ":"400 ")+s.fontSize+'px '+(s.fontFamily==="Noto Emoji"?'"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Noto Emoji"':'"'+s.fontFamily+'", "Noto Emoji"')+', sans-serif';
        const measure=(text,s)=>{ctx.font=face(s);ctx.letterSpacing=s.letterSpacing+"px";return ctx.measureText(text).width;};
        const fs=l.autoFit?fitFontSize(style,{width:w,height:h},measure):l.fontSize;
        const s={...style,fontSize:fs}; const rows=wrapLines(l.text,w,s,measure);
        ctx.font=face(s);ctx.letterSpacing=l.letterSpacing+"px";ctx.fillStyle=l.color;ctx.textAlign=l.align==="justify"?"left":l.align;ctx.textBaseline="top";
        const anchor=l.align==="center"?w/2:l.align==="right"?w:0;
        for(let i=0;i<rows.length;i++){const y=i*fs*s.lineHeight;ctx.fillText(rows[i],anchor,y,w);if(l.underline||l.strike){const width=measure(rows[i],s);ctx.fillRect(anchor-(l.align==="center"?width/2:l.align==="right"?width:0),y+fs*(l.strike?.5:.93),width,Math.max(1,fs*.045));}}
      }else if(l.type==="line"){
        ctx.strokeStyle=l.stroke;ctx.lineWidth=Math.max(.5,l.strokeWidth);ctx.lineCap="round";if(l.dashed)ctx.setLineDash([l.strokeWidth*2.2,l.strokeWidth*1.8]);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(w,0);ctx.stroke();
        ctx.setLineDash([]);for(const [show,x,sign] of [[l.arrowStart,0,1],[l.arrowEnd,w,-1]])if(show){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+sign*10,-5);ctx.lineTo(x+sign*10,5);ctx.closePath();ctx.fillStyle=l.stroke;ctx.fill();}
      }else{
        const points=l.shape==="star"?starPointsEx(l.starPoints,l.innerRatio):maskPolygon(l.shape);
        let path;
        if(l.shape==="path"&&l.pathData){const source=new Path2D(l.pathData);path=new Path2D();path.addPath(source,new DOMMatrix([w/100,0,0,h/100,0,0]));}
        else if(l.template&&l.shape==="circle"){path=new Path2D();path.ellipse(w/2,h/2,w/2,h/2,0,0,Math.PI*2);}
        else if(l.template&&l.shape==="triangle"){path=new Path2D();path.moveTo(0,h);path.lineTo(w/2,0);path.lineTo(w,h);path.closePath();}
        else if(l.template&&l.shape==="star"){path=new Path2D();const pts=stretchPts(starPointsEx(l.starPoints,l.innerRatio),0,0,w,h);pts.forEach(([x,y],i)=>i?path.lineTo(x,y):path.moveTo(x,y));path.closePath();}
        else if(l.template&&l.shape==="rounded"){path=new Path2D();path.roundRect(0,0,w,h,Math.min(l.cornerRadius,w/2,h/2));}
        else if(points) {tracePts(ctx,points,w,h);}
        else {ctx.beginPath();ctx.rect(0,0,w,h);}
        if(l.type==="shape"){ctx.fillStyle=l.gradient?gradientPaint(ctx,l.gradient,w,h):l.color;if(path)ctx.fill(path);else ctx.fill();if(l.stroke!=="transparent"&&l.strokeWidth){ctx.strokeStyle=l.stroke;ctx.lineWidth=l.strokeWidth;if(path)ctx.stroke(path);else ctx.stroke();}}
        else {if(path)ctx.clip(path);else ctx.clip();const i=getImage(l.image);if(i.complete&&i.naturalWidth){const scale=Math.min(w/i.naturalWidth,h/i.naturalHeight);const dw=i.naturalWidth*scale,dh=i.naturalHeight*scale;ctx.drawImage(i,(w-dw)/2,(h-dh)/2,dw,dh);}}
      }
      ctx.restore();
    }
  }
  function point(event){const r=canvas.getBoundingClientRect();return {x:(event.clientX-r.left)*WIDTH/r.width,y:(event.clientY-r.top)*getHeight()/r.height};}
  function start(event) {
    const p=point(event); const l=[...read()].reverse().find(l=>{
      if(l.hidden)return false;const b=box(l),r=-l.rotation*Math.PI/180,centered=!l.template||["circle","star"].includes(l.shape);
      const dx=p.x-b.x-(centered?b.w/2:0),dy=p.y-b.y-(centered?b.h/2:0);
      const localX=dx*Math.cos(r)-dy*Math.sin(r)+(centered?b.w/2:0),localY=dx*Math.sin(r)+dy*Math.cos(r)+(centered?b.h/2:0);
      return localX>=0&&localX<=b.w&&localY>=-(l.type==="line"?8:0)&&localY<=Math.max(b.h,l.type==="line"?8:0);
    });
    if(!l)return false;
    selected=l.id;sync();drag={pointer:event.pointerId,p,l,previous:read(),moved:false};canvas.setPointerCapture(event.pointerId);return true;
  }
  function dragMove(event){
    if(drag?.pointer!==event.pointerId)return false;
    const p=point(event),l=drag.l;
    if(!drag.moved){history(drag.previous);drag.moved=true;}
    update(read().map(i=>i.id===l.id?{...i,x:clamp(l.x+(p.x-drag.p.x)/WIDTH,l.template?-2:0,l.template?3:1-l.w,l.x),y:clamp(l.y+(p.y-drag.p.y)/getHeight(),l.template?-2:0,l.template?3:1-l.h,l.y)}:i),{remember:false,refresh:false});return true;
  }
  function end(){if(!drag)return false;drag=null;sync();return true;}
  return {sync,paint,start,dragMove,end,getSelected:active,addLayer:add,updateSelected:patch=>{const l=active();if(l)update(sanitizeLayers(read().map(item=>item.id===l.id?{...item,...patch}:item)));},replaceLayers:next=>{selected=null;update(sanitizeLayers(next));},hasAnimation:()=>read().some(l=>!l.hidden&&l.animation!=="none"),ready:()=>read().filter(l=>l.type==="image"&&!l.hidden).every(l=>{const i=getImage(l.image);return i.complete&&i.naturalWidth>0;})};
}
