import test from "node:test";
import assert from "node:assert/strict";
import {sanitizeLayers} from "../public/admin-ad-studio/design-layers.js";
import {maskPolygon} from "../public/admin-ad-studio/canvix/shapes.ts";
import {fitFontSize} from "../public/admin-ad-studio/canvix/text-fit.ts";
import {animateElementAt} from "../public/admin-ad-studio/canvix/element-animation.ts";

test("layer project data is bounded, defaults safely and rejects remote images",()=>{
  const layers=sanitizeLayers([{id:"a",type:"shape",shape:"heart",x:-2,w:4,opacity:12,color:"bad"},
    {id:"a",type:"text",text:"hello",rotation:-300},{type:"image",image:"https://example.com/image.png"},{type:"unknown"}]);
  assert.equal(layers.length,2);
  assert.equal(layers[0].x,0);assert.equal(layers[0].w,1);assert.equal(layers[0].opacity,1);
  assert.equal(layers[0].color,"#ffffff");assert.notEqual(layers[0].id,layers[1].id);
  assert.equal(layers[1].rotation,-180);
  assert.deepEqual(sanitizeLayers(undefined),[]);
});
test("upstream Canvix geometry, auto-fit and animation are available in the adapter",()=>{
  assert.equal(maskPolygon("hexagon").length,6);
  assert.equal(maskPolygon("none"),null);
  const style={text:"a long line of text",fontSize:70,fontFamily:"Arial",bold:true,italic:false,lineHeight:1.2,letterSpacing:0};
  assert.ok(fitFontSize(style,{width:120,height:50},(text,s)=>text.length*s.fontSize*.5)<70);
  const element={width:100,height:100,animation:{kind:"fade",duration:1,easing:"linear"}};
  assert.equal(animateElementAt(element,0.5).opacity,.5);
  assert.equal(animateElementAt(element,1).opacity,1);
});

test("every Canvix template and every page imports without losing elements",async()=>{
  const {readFile}=await import("node:fs/promises");
  const {cleanDocument}=await import("../public/admin-ad-studio/template-library.js");
  const dir=new URL("../public/admin-ad-studio/canvix/templates/",import.meta.url);
  const json=async name=>JSON.parse(await readFile(new URL(name,dir),"utf8"));
  const index=await json("index.json"),packs=new Map();
  assert.equal(index.length,366);
  assert.equal(new Set(index.map(t=>t.slug)).size,366);
  let pages=0,elementCount=0;
  for(const entry of index){
    if(!packs.has(entry.file))packs.set(entry.file,await json(entry.file));
    const raw=packs.get(entry.file)[entry.slug],doc=cleanDocument(raw);
    assert.ok(doc,entry.slug);
    assert.equal(doc.pages.length,raw.pages.length,entry.slug);
    for(let i=0;i<doc.pages.length;i++){
      assert.equal(doc.pages[i].layers.length,raw.pages[i].layers.length,entry.slug+" page "+i);
      assert.equal(doc.pages[i].background.type,raw.pages[i].background.type);
      elementCount+=doc.pages[i].layers.length;
    }
    pages+=doc.pages.length;
  }
  assert.equal(pages,426);
  assert.equal(elementCount,5097);
});
