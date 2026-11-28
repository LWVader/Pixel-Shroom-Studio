import {sanitizeLayers} from "./design-layers.js";
const $=id=>document.getElementById(id);
const tools=[
 ["design","AI design generator","Describe a new advertisement, its audience, message and style."],
 ["assistant","Design assistant","Describe changes to text and shape layers. Review the proposed replacement before applying."],
 ["write","Magic Write","Ask for headlines, product copy, calls to action or social captions."],
 ["translate","Translate","Enter the target language and any instructions."],
 ["theme","AI brand palette","Describe your brand, colors or ideal mood."],
 ["image","AI image generation","Describe an artwork or background to generate."],
 ["imageEdit","Magic image edit","Choose artwork and describe the edit."],
 ["removeBackground","AI background removal","Choose an artwork to isolate the subject. AI editing may change fine details."],
 ["magicLayers","Magic Layers","Choose flat artwork to recover editable text, shapes and cropped image regions; results are approximate."],
 ["altText","Image alt text","Choose artwork to generate a concise accessible description."],
 ["notes","Campaign / speaker notes","Describe the campaign or presentation notes you need."],
 ["video","AI video generation","Describe a short animated social clip. Requires a video-capable provider."]
];
const imageTools=new Set(["imageEdit","removeBackground","magicLayers","altText"]);
const textTools=new Set(["write","translate","notes"]);
async function api(action,body){
  const r=await fetch("/api/ad-studio/ai/"+action,body===undefined?{credentials:"same-origin"}:{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok){let message="AI request failed.";try{message=(await r.json()).error||message;}catch{}throw Error(message);}
  return action==="videoContent"?r.blob():r.json();
}
const loadImage=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error("Could not decode the artwork."));im.src=src;});
async function compactImage(src){const im=await loadImage(src),scale=Math.min(1,1600/Math.max(im.naturalWidth,im.naturalHeight));const c=document.createElement("canvas");c.width=Math.max(1,Math.round(im.naturalWidth*scale));c.height=Math.max(1,Math.round(im.naturalHeight*scale));c.getContext("2d").drawImage(im,0,0,c.width,c.height);return c.toDataURL("image/webp",.9);}
async function cropLayer(im,l){const c=document.createElement("canvas");c.width=Math.max(1,Math.round(im.naturalWidth*l.w));c.height=Math.max(1,Math.round(im.naturalHeight*l.h));c.getContext("2d").drawImage(im,im.naturalWidth*l.x,im.naturalHeight*l.y,c.width,c.height,0,0,c.width,c.height);return c.toDataURL("image/webp",.9);}
export function initAITools({canvas,getState,getSelected,prepareImage,applyDocument,addLayer,applyText,applyPalette,useVideo,applyImage}){
  const dialog=$("ai-dialog"),selector=$("ai-tool"),prompt=$("ai-prompt"),status=$("ai-status"),output=$("ai-output"),run=$("ai-run");
  let capabilities={},result=null,sourceImage="",videoURL=null,busy=false;
  for(const [id,label] of tools)selector.add(new Option(label,id));
  const current=()=>selector.value;
  function clearResult(){result=null;output.value="";$("ai-output-wrap").hidden=true;$("ai-preview-image").hidden=true;$("ai-preview-video").hidden=true;$("ai-apply").hidden=true;$("ai-download").hidden=true;$("ai-apply").disabled=false;if(videoURL)URL.revokeObjectURL(videoURL);videoURL=null;$("ai-preview-video").removeAttribute("src");$("ai-preview-image").removeAttribute("src");}
  function sync(){
    const mode=current(),entry=tools.find(t=>t[0]===mode);
    $("ai-hint").textContent=entry[2];$("ai-image-source").hidden=!imageTools.has(mode);$("ai-text-source").hidden=!textTools.has(mode);
    $("ai-prompt-wrap").hidden=mode==="removeBackground";
    run.disabled=busy||!capabilities[mode];$("ai-unavailable").hidden=!!capabilities[mode];
    $("ai-source-note").textContent=getSelected()?.type==="image"?"Selected image layer available.":"Choose a file or use the current ad preview.";
  }
  $("open-ai").onclick=async()=>{
    dialog.showModal();status.textContent="Checking configured AI services…";
    try{const data=await api("config");capabilities=data.tools||{};status.textContent=Object.values(capabilities).some(Boolean)?"AI provider configured. Only enabled tools can run.":"AI is not configured. Set the Worker provider key and model variables shown below.";for(const o of selector.options){const label=tools.find(t=>t[0]===o.value)[1];o.textContent=label+(capabilities[o.value]?"":" · setup required");}sync();}
    catch(e){status.textContent=e.message;}
  };
  $("close-ai").onclick=()=>dialog.close();
  selector.onchange=()=>{clearResult();status.textContent="";sync();};
  async function getImage(){
    const file=$("ai-file").files[0];if(file){const {data}=await prepareImage(file);return data;}
    if($("ai-use-canvas").checked)return compactImage(canvas.toDataURL("image/png"));
    const l=getSelected();if(l?.type==="image")return l.image;
    throw Error("Choose an image file, select an image layer, or use the current ad.");
  }
  function showResult(mode,out){
    result={mode,...out};const label=$("ai-apply");
    if(out.text!==undefined){$("ai-output-wrap").hidden=false;output.value=out.text;label.textContent=mode==="altText"||mode==="notes"?"Copy generated text":"Apply to selected text layer or social caption";}
    if(out.colors){$("ai-output-wrap").hidden=false;output.value=out.name+"\n"+out.colors.join(" ");label.textContent="Apply brand palette";}
    if(out.design){$("ai-output-wrap").hidden=false;output.value=out.design.name+"\n\n"+out.design.layers.map(l=>l.type+": "+(l.text||l.name)+(mode==="magicLayers"?" ("+Math.round(l.confidence*100)+"% confidence)":"")).join("\n");label.textContent="Replace design with editable result";}
    if(out.image){$("ai-preview-image").src=out.image;$("ai-preview-image").hidden=false;label.textContent=mode==="image"?"Add artwork as image layer":"Replace selected image or add result";}
    if(out.video){videoURL=URL.createObjectURL(out.video);$("ai-preview-video").src=videoURL;$("ai-preview-video").hidden=false;$("ai-download").hidden=false;$("ai-download").href=videoURL;label.textContent="Use finished clip in publishing";}
    label.hidden=false;
  }
  run.onclick=async()=>{
    if(busy)return;clearResult();busy=true;selector.disabled=true;sync();const mode=current();
    try{
      status.textContent="Working… AI requests may take a minute and may incur provider charges.";
      const state=getState(),selected=getSelected();
      const p=prompt.value.trim();
      const body={prompt:p,text:textTools.has(mode)?$("ai-source-text").value.trim()||selected?.text||state.socialCaption||state.headline:"",portrait:canvas.height>=canvas.width};
      if(mode==="assistant")body.text=JSON.stringify({layers:state.layers.filter(l=>["text","shape"].includes(l.type)).map(({type,name,x,y,w,h,color,text,fontSize,font,bold,shape})=>({type,name,x,y,w,h,color,text,fontSize,font,bold,shape}))}).slice(0,10000);
      if(imageTools.has(mode)){sourceImage=await getImage();body.image=sourceImage;}
      const out=await api(mode,body);
      if(mode==="video"){
        if(!out.id)throw Error("The provider returned no video job.");
        let job=out;
        for(let i=0;i<48&&job.status!=="completed";i++){
          if(["failed","cancelled","canceled","expired"].includes(job.status))throw Error("The video provider could not finish this clip.");
          status.textContent="Generating video · "+(job.progress??0)+"%";
          await new Promise(r=>setTimeout(r,10000));job=await api("videoStatus",{id:out.id});
        }
        if(job.status!=="completed")throw Error("Video is still processing. Try again later in your provider account.");
        out.video=await api("videoContent",{id:out.id});
      }
      showResult(mode,out);status.textContent="Result ready. Review it before applying.";
    }catch(e){status.textContent=e.message;}
    finally{busy=false;selector.disabled=false;sync();}
  };
  $("ai-apply").onclick=async()=>{
    if(!result)return;const button=$("ai-apply");button.disabled=true;
    try{
      if(result.video){useVideo(result.video);dialog.close();return;}
      if(result.image){const data=await compactImage(result.image);await applyImage(data,result.mode!=="image");dialog.close();return;}
      if(result.colors){applyPalette(result.colors,result.name);dialog.close();return;}
      if(result.design){
        let layers=result.design.layers.map(l=>({...l}));
        let width=canvas.width,height=canvas.height;
        if(result.mode==="magicLayers"){
          const im=await loadImage(sourceImage);width=im.naturalWidth;height=im.naturalHeight;
          layers=await Promise.all(layers.map(async l=>l.type==="image"?{...l,image:await cropLayer(im,l),shape:"none"}:l));
        }
        applyDocument({name:result.design.name,width,height,pages:[{background:{type:"solid",color:result.design.background},layers:sanitizeLayers(layers)}]});dialog.close();return;
      }
      if(["notes","altText"].includes(result.mode)){await navigator.clipboard.writeText(output.value);status.textContent="Copied to clipboard.";return;}
      applyText(output.value);dialog.close();
    }catch(e){status.textContent=e.message||"Could not apply the result.";}
    finally{button.disabled=false;}
  };
  $("ai-source-text").placeholder="Defaults to selected layer or current social copy";
  sync();
}
