import {sanitizeLayers,safeColor,safeGradient,gradientPaint} from "./design-layers.js";
const $=id=>document.getElementById(id);
export function cleanDocument(doc){
  if(!doc||typeof doc!=="object"||!Array.isArray(doc.pages)||!doc.pages.length)return null;
  const dim=v=>Math.min(2560,Math.max(128,Math.round(Number(v)||1080)));
  return {slug:String(doc.slug||"custom").slice(0,100),name:String(doc.name||"Custom design").slice(0,100),category:String(doc.category||"social").slice(0,30),
    width:dim(doc.width),height:dim(doc.height),page:Math.max(0,Math.min(doc.pages.length-1,Math.floor(Number(doc.page)||0),19)),
    pages:doc.pages.slice(0,20).map(p=>({background:p?.background?.type==="gradient"?{...safeGradient({...p.background,type:"linear"}),type:"gradient"}:{type:"solid",color:safeColor(p?.background?.color,"#ffffff")},layers:sanitizeLayers(p?.layers)})),
    fields:Array.isArray(doc.fields)?doc.fields.slice(0,30).filter(f=>f&&/^[a-z0-9_]{1,50}$/i.test(f.key)).map(f=>({key:f.key,label:String(f.label||f.key).slice(0,100),example:String(f.example||"").slice(0,200)})):[]
  };
}
export function paintTemplateBackground(ctx,background,width,height){
  if(!background)return;
  ctx.save();
  ctx.fillStyle=background.type==="gradient"?gradientPaint(ctx,{...background,type:"linear"},width,height):background.color;
  ctx.fillRect(0,0,width,height);ctx.restore();
}
export function initTemplateLibrary({getDocument,applyDocument,changePage,drawPreview}){
  const dialog=$("template-dialog"),list=$("template-list"),query=$("template-search"),category=$("template-category"),preview=$("template-preview");
  let manifest=[],shown=60,selection=null,doc=null,seq=0;
  const packs=new Map();
  async function loadPack(entry){
    if(!packs.has(entry.file))packs.set(entry.file,fetch("canvix/templates/"+entry.file).then(r=>{if(!r.ok)throw Error("Template data could not load.");return r.json();}).catch(e=>{packs.delete(entry.file);throw e;}));
    return (await packs.get(entry.file))[entry.slug];
  }
  function render(){
    const term=query.value.trim().toLowerCase(),matches=manifest.filter(t=>(category.value==="all"||t.category===category.value)&&(!term||(t.name+" "+t.category).toLowerCase().includes(term)));
    list.replaceChildren();$("template-count").textContent=matches.length+" of "+manifest.length+" templates";
    for(const t of matches.slice(0,shown)){
      const b=document.createElement("button");b.type="button";b.className="template-card";b.setAttribute("aria-pressed",String(selection?.slug===t.slug));b.classList.toggle("selected",selection?.slug===t.slug);
      const swatch=document.createElement("span");swatch.className="template-accent";swatch.style.background=t.accent;
      const title=document.createElement("strong");title.textContent=t.name;
      const info=document.createElement("small");info.textContent=t.category+" · "+t.width+" × "+t.height+(t.pages>1?" · "+t.pages+" pages":"");
      b.append(swatch,title,info);b.onclick=()=>select(t);list.append(b);
    }
    $("template-more").hidden=matches.length<=shown;
  }
  async function select(t){
    selection=t;doc=null;render();$("template-apply").disabled=true;$("template-selected-title").textContent=t.name; $("template-preview-status").textContent="Loading editable design…";
    const token=++seq;
    try{
      const raw=await loadPack(t);if(token!==seq)return;doc=cleanDocument(raw);if(!doc)throw Error("Template is not valid.");
      $("template-preview-status").textContent=doc.pages.length+" editable "+(doc.pages.length===1?"page":"pages")+" · "+doc.width+" × "+doc.height;
      if(drawPreview)drawPreview(preview,doc);
      $("template-apply").disabled=false;
      const fields=$("template-fields");fields.replaceChildren();for(const f of doc.fields){const label=document.createElement("label");label.textContent=f.label;const input=document.createElement("input");input.value=f.example;input.dataset.key=f.key;input.maxLength=200;label.append(input);fields.append(label);}
    }catch(e){if(token===seq)$("template-preview-status").textContent=e.message;}
  }
  $("open-templates").onclick=async()=>{
    dialog.showModal();
    if(manifest.length)return;
    $("template-count").textContent="Loading library…";
    try{const r=await fetch("canvix/templates/index.json");if(!r.ok)throw Error("Template library could not load.");manifest=await r.json();render();}
    catch(e){$("template-count").textContent=e.message;}
  };
  $("close-templates").onclick=()=>dialog.close();
  for(const el of [query,category])el.addEventListener("input",()=>{shown=60;render();});
  $("template-more").onclick=()=>{shown+=60;render();};
  $("template-apply").onclick=()=>{
    if(!doc)return;
    const result=structuredClone(doc);const vals=Object.fromEntries([...$("template-fields").querySelectorAll("input")].map(input=>[input.dataset.key,input.value]));
    for(const p of result.pages)for(const l of p.layers)if(l.type==="text")l.text=l.text.replace(/\{\{([\w]+)\}\}/g,(match,key)=>Object.hasOwn(vals,key)?vals[key]:match);
    applyDocument(result);dialog.close();
  };
  $("template-page").onchange=e=>changePage(Number(e.target.value));
  const sync=()=>{
    const d=getDocument();$("template-pages").hidden=!d;
    if(d){$("template-name").textContent=d.name;const el=$("template-page");if(el.options.length!==d.pages.length)el.replaceChildren(...d.pages.map((_,i)=>new Option("Page "+(i+1),i)));el.value=d.page;}
  };
  return {sync};
}
