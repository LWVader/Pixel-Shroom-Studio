// Canvix-inspired AI operations adapted to the existing admin Worker.
// Provider credentials and model selection are controlled by the Worker, never the browser.
export const AI_TOOLS={
  write:"text",translate:"text",theme:"text",assistant:"text",design:"text",notes:"text",altText:"vision",magicLayers:"vision",
  image:"image",imageEdit:"image",removeBackground:"image",video:"video"
};
const response=(body,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const bounded=(v,max)=>typeof v==="string"?v.trim().slice(0,max):"";
const imagePattern=/^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=]+)$/i;
function provider(env){
  const key=env.AD_STUDIO_AI_KEY||env.OPENAI_API_KEY||env.ZAI_API_KEY||"";
  const input=env.AD_STUDIO_AI_BASE_URL||env.ZAI_BASE_URL||"https://api.openai.com/v1";
  let url;try{url=new URL(input);}catch{return null;}
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||!key)return null;
  return {key,base:url.toString().replace(/\/$/,""),text:env.AD_STUDIO_AI_TEXT_MODEL||env.ZAI_TEXT_MODEL||"",vision:env.AD_STUDIO_AI_VISION_MODEL||env.ZAI_VISION_MODEL||env.AD_STUDIO_AI_TEXT_MODEL||env.ZAI_TEXT_MODEL||"",image:env.AD_STUDIO_AI_IMAGE_MODEL||env.ZAI_IMAGE_MODEL||"",video:env.AD_STUDIO_AI_VIDEO_MODEL||""};
}
export function aiCapabilities(env){
  const p=provider(env);return {configured:!!p,tools:Object.fromEntries(Object.entries(AI_TOOLS).map(([op,slot])=>[op,!!p?.[slot]]))};
}
const designSchema='Return JSON only: {"name":"Design title","background":"#ffffff","layers":[{"type":"text" or "shape","name":"short name","x":0.05,"y":0.1,"w":0.9,"h":0.18,"color":"#112233","text":"editable copy","fontSize":48,"font":"Arial","bold":true,"shape":"rounded" or "none" or "circle"}]}. Coordinates are fractions of the page, 0–1; text size is in a logical width of 864px. Up to 24 elements. Use clear hierarchy and contrast, avoid overlapping important text.';

const prompts={
  write:"Write polished social advertising copy. Follow the brief, avoid unsupported claims, and return only the proposed text.",
  translate:"Translate the submitted text into the requested language. Preserve structure, names, numerical claims and emoji. Return only the translation.",
  notes:"Create concise speaker notes or campaign production notes. Return plain text.",
  altText:"Describe the visible artwork concisely for accessibility. Return plain text only.",
  theme:'Suggest a cohesive five-color brand palette. Return JSON only: {"colors":["#123456","#abcdef","#112233","#445566","#778899"],"name":"palette name"}. Use six-digit hex colors.',
  assistant:"You are a graphic design assistant. Revise the supplied editable design based on the user's brief. Keep important content and return the entire revised design. "+designSchema,
  design:"Create a polished editable advertising or social media layout from the brief. "+designSchema,
  magicLayers:'Identify visually distinct text and image regions and simple shapes in the uploaded artwork. Return JSON only: {"name":"Recovered design","background":"#ffffff","layers":[{"type":"text" or "image" or "shape","name":"region name","x":0.1,"y":0.1,"w":0.3,"h":0.2,"text":"visible text","color":"#112233","fontSize":40,"font":"Arial","confidence":0.9}]}. Coordinates are fractions of the original image. Image regions will be cropped from the original, never invented. Do not claim exact font recovery. Return at most 24 regions and exclude low-confidence guesses.'
};
const hex=(v,fallback="#ffffff")=>typeof v==="string"&&/^#[0-9a-f]{6}$/i.test(v)?v:fallback;
const clamp=(v,min,max,fallback)=>Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):fallback;
function parseJSON(raw){return JSON.parse(raw.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\s*\x60\x60\x60$/,""));}
function normalizeDesign(value,allowImages){
  if(!value||!Array.isArray(value.layers))throw Error("Invalid design output");
  const layers=value.layers.slice(0,24).filter(l=>l&&["text","shape",...(allowImages?["image"]:[])].includes(l.type)).map(l=>{
    const x=clamp(l.x,0,.97,0),y=clamp(l.y,0,.97,0);
    return {type:l.type,name:bounded(l.name,64)||l.type,x,y,w:clamp(l.w,.02,1-x,.2),h:clamp(l.h,.02,1-y,.15),color:hex(l.color,"#ffffff"),text:bounded(l.text,1200),fontSize:clamp(l.fontSize,12,160,40),font:typeof l.font==="string"&&/^[a-z0-9 -]{1,70}$/i.test(l.font)?l.font:"Arial",bold:l.bold!==false,shape:["none","rounded","circle","triangle","star","heart"].includes(l.shape)?l.shape:"none",confidence:clamp(l.confidence,0,1,.8)};
  });
  if(!layers.length)throw Error("No usable elements");
  return {name:bounded(value.name,100)||"AI design",background:hex(value.background),layers};
}
async function call(p,path,options={}){
  const headers=new Headers(options.headers);headers.set("Authorization","Bearer "+p.key);
  if(typeof options.body==="string")headers.set("Content-Type","application/json");
  const r=await fetch(p.base+path,{...options,headers,redirect:"error",signal:AbortSignal.timeout(120000)});
  if(!r.ok)throw {status:r.status===429?429:502,error:r.status===429?"AI provider limit reached. Try again later.":r.status===401||r.status===403?"AI provider rejected its credentials or model access.":"AI provider could not complete this request (HTTP "+r.status+")."};
  return r;
}
const rateBuckets=new Map();
function reserve(user,slot){
  const key=user.id+":"+slot,now=Date.now(),bucket=rateBuckets.get(key);
  if(!bucket||bucket.until<now){rateBuckets.set(key,{until:now+60000,count:1});return true;}
  return ++bucket.count<=(slot==="image"||slot==="video"?3:12);
}
function imagePart(data){
  const match=imagePattern.exec(data||"");if(!match||data.length>8_000_000)throw {status:400,error:"Select a PNG, JPEG or WebP image under the AI upload limit."};
  return new File([Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0))],"artwork."+match[1],{type:"image/"+match[1]});
}
export async function handleAdStudioAI(action,body,env,user){
  const p=provider(env);
  if(action==="config")return response(aiCapabilities(env));
  const slot=Object.hasOwn(AI_TOOLS,action)?AI_TOOLS[action]:action==="videoStatus"||action==="videoContent"?"video":null;
  if(!slot)return response({error:"Unknown AI tool."},404);
  if(!p?.[slot])return response({error:"Configure the AI provider key and "+slot+" model on your Worker."},503);
  if(!reserve(user,action==="videoStatus"||action==="videoContent"?"poll":slot))return response({error:"Too many AI requests. Wait a minute."},429);
  try{
    const prompt=bounded(body?.prompt,4000),text=bounded(body?.text,10000),data=typeof body?.image==="string"?body.image:"";
    if(["videoStatus","videoContent"].includes(action)){
      const id=bounded(body?.id,120);if(!/^video_[a-z0-9_-]{1,110}$/i.test(id))return response({error:"Invalid video job."},400);
      const r=await call(p,"/videos/"+encodeURIComponent(id)+(action==="videoContent"?"/content":""));
      if(action==="videoContent")return new Response(r.body,{headers:{"Content-Type":"video/mp4","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
      const out=await r.json();return response({id,status:bounded(out.status,30),progress:clamp(out.progress,0,100,0)});
    }
    if(action==="video"){
      if(!prompt)return response({error:"Enter a video prompt."},400);
      const form=new FormData();form.set("model",p.video);form.set("prompt",prompt);form.set("seconds","4");form.set("size",body?.portrait===false?"1280x720":"720x1280");
      const out=await (await call(p,"/videos",{method:"POST",body:form})).json();
      return response({id:bounded(out.id,120),status:bounded(out.status,30)});
    }
    if(slot==="image"){
      let request;
      if(action==="image"){
        if(!prompt)return response({error:"Enter an image prompt."},400);
        request=await call(p,"/images/generations",{method:"POST",body:JSON.stringify({model:p.image,prompt,n:1,size:"1024x1024"})});
      }else{
        if(action==="imageEdit"&&!prompt)return response({error:"Enter the image editing instruction."},400);
        const form=new FormData();form.set("model",p.image);form.set("image",imagePart(data));form.set("prompt",action==="removeBackground"?"Isolate the original foreground subject on a transparent background. Retain its visual identity, colors and proportions; remove only the background.":prompt);
        form.set("size","auto");if(action==="removeBackground")form.set("background","transparent");
        request=await call(p,"/images/edits",{method:"POST",body:form});
      }
      const out=await request.json();const b64=out?.data?.[0]?.b64_json;
      if(typeof b64!=="string"||b64.length>16_000_000||!/^[a-z0-9+/=]+$/i.test(b64))throw Error("Invalid image output");
      return response({image:"data:image/png;base64,"+b64});
    }
    if(!prompt&&!text&&slot!=="vision")return response({error:"Enter a prompt or text."},400);
    const content=slot==="vision"?[{type:"text",text:prompt||"Analyze this artwork."},{type:"image_url",image_url:{url:data}}]:prompt+"\n\n"+text;
    if(slot==="vision")imagePart(data);
    const model=slot==="vision"?p.vision:p.text;
    const r=await call(p,"/chat/completions",{method:"POST",body:JSON.stringify({model,messages:[{role:"system",content:prompts[action]},{role:"user",content}]})});
    const raw=bounded((await r.json())?.choices?.[0]?.message?.content,40000);
    if(!raw)throw Error("Empty output");
    if(action==="design"||action==="assistant"||action==="magicLayers")return response({design:normalizeDesign(parseJSON(raw),action==="magicLayers")});
    if(action==="theme"){
      const theme=parseJSON(raw),colors=Array.isArray(theme.colors)?theme.colors.filter(c=>/^#[0-9a-f]{6}$/i.test(c)).slice(0,5):[];
      if(colors.length<3)throw Error("Invalid palette");return response({colors,name:bounded(theme.name,48)||"AI palette"});
    }
    return response({text:raw.slice(0,12000)});
  }catch(e){return response({error:typeof e?.error==="string"?e.error:"AI returned an unsupported result or the provider did not respond. Try a shorter prompt."},e.status||502);}
}
