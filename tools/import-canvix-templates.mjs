// Generate the complete editable template library from a local Canvix checkout.
// Usage: node tools/import-canvix-templates.mjs ../canvix-pixel
import {build} from "esbuild";
import {mkdir,writeFile,mkdtemp,rm} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {createRequire} from "node:module";
const upstream=resolve(process.argv[2]||"../canvix-pixel");
const tmp=await mkdtemp(join(tmpdir(),"canvix-templates-"));
const dest=resolve("public/admin-ad-studio/canvix/templates");
await mkdir(dest,{recursive:true});
try{
  const file=join(tmp,"templates.cjs");
  await build({entryPoints:[join(upstream,"src/lib/templates/index.ts")],bundle:true,platform:"node",format:"cjs",outfile:file});
  const {TEMPLATES}=createRequire(import.meta.url)(file);
  const manifest=[];
  const round=v=>Math.round(v*1e6)/1e6;
  for(let start=0;start<TEMPLATES.length;start+=24){
    const filename="pack-"+String(start/24+1).padStart(2,"0")+".json", templates={};
    for(const t of TEMPLATES.slice(start,start+24)){
      const pages=t.pages.map((p,pi)=>({background:p.background,layers:p.elements.map((e,i)=>{
        const s=864/t.width, type=e.type==="text"||e.type==="sticker"?"text":e.type==="line"?"line":"shape";
        const layer={id:"p"+pi+"-"+i,type,name:e.type==="text"?e.text.slice(0,64):e.type==="sticker"?"Sticker "+e.char:e.type,
          x:round(e.x/t.width),y:round(e.y/t.height),w:round(e.width/t.width),h:round(e.height/t.height),
          color:e.fill??e.stroke??(e.type==="sticker"?"#000000":"#ffffff"),opacity:e.opacity,rotation:e.rotation,
          hidden:!e.visible,text:e.text??e.char??"",font:e.fontFamily??(e.type==="sticker"?"Noto Emoji":"Arial"),
          fontSize:round((e.fontSize??48)*s),bold:e.bold??false,italic:e.italic??false,underline:e.underline??false,strike:e.strike??false,
          align:e.align??(e.type==="sticker"?"center":"left"),lineHeight:e.lineHeight??1.18,letterSpacing:round((e.letterSpacing??0)*s),autoFit:false,
          shape:({rect:e.cornerRadius?"rounded":"none",ellipse:"circle",triangle:"triangle",star:"star",path:"path"})[e.type]??"none",
          cornerRadius:round((e.cornerRadius??0)*s),stroke:e.stroke??"transparent",strokeWidth:round((e.strokeWidth??0)*s),
          pathData:e.pathData??"",gradient:e.fillGradient??null,dashed:e.dashed??false,arrowStart:e.arrowStart??false,arrowEnd:e.arrowEnd??false,
          starPoints:e.numPoints??5,innerRatio:e.innerRatio??.55,animation:"none",template:true};
        const defaults={hidden:false,opacity:1,rotation:0,text:"",font:"Arial",fontSize:48,bold:false,italic:false,underline:false,strike:false,align:"left",lineHeight:1.18,letterSpacing:0,shape:"none",cornerRadius:0,stroke:"transparent",strokeWidth:0,pathData:"",gradient:null,dashed:false,arrowStart:false,arrowEnd:false,starPoints:5,innerRatio:.55,animation:"none"};
        for(const [key,value] of Object.entries(defaults))if(layer[key]===value)delete layer[key];
        return layer;
      })}));
      templates[t.slug]={slug:t.slug,name:t.name,category:t.category,width:t.width,height:t.height,accent:t.accent,pages,fields:t.fields??[]};
      manifest.push({slug:t.slug,name:t.name,category:t.category,width:t.width,height:t.height,accent:t.accent,pages:pages.length,file:filename,fields:t.fields?.length??0});
    }
    await writeFile(join(dest,filename),JSON.stringify(templates));
  }
  await writeFile(join(dest,"index.json"),JSON.stringify(manifest));
  console.log("Imported",manifest.length,"templates across",manifest.reduce((n,t)=>n+t.pages,0),"pages");
}finally{await rm(tmp,{recursive:true,force:true});}
