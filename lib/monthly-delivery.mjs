const bucket = "monthly-asset-packs";
export const MAX_PACK_BYTES = 25 * 1024 * 1024;
const monthPattern = /^20\d{2}-(0[1-9]|1[0-2])$/;
const safeId = (value, prefix) => typeof value === "string" && new RegExp("^" + prefix + "_[A-Za-z0-9]+$").test(value);
const epoch = () => Math.floor(Date.now()/1000);
const fail = (error, status = 400) => ({error, status});
const sql = (env, statement, ...args) => env.CAMPAIGN_DB.prepare(statement).bind(...args);

function supabaseOrigin(env) {
  try {
    const url = new URL(env.SUPABASE_URL);
    if (url.protocol === "https:" && /^[a-z0-9]+\.supabase\.co$/.test(url.hostname) &&
        url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password && !url.port) return url.origin;
  } catch {}
  return "";
}
function storageConfigured(env) { return Boolean(supabaseOrigin(env) && env.SUPABASE_SERVICE_ROLE_KEY); }
export function deliveryConfiguration(env) {
  return {
    storage: storageConfigured(env),
    stripe: Boolean(env.STRIPE_MONTHLY_WEBHOOK_SECRET && env.CAMPAIGN_MONTHLY_PRICE_ID),
    email: Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL),
    enabled: env.MONTHLY_DELIVERY_ENABLED === "true"
  };
}
function ready(env) {
  const c = deliveryConfiguration(env);
  return c.storage && c.stripe && c.email && c.enabled && env.CAMPAIGN_DB;
}
async function storage(env, path, options = {}) {
  const origin = supabaseOrigin(env);
  if (!origin || !env.SUPABASE_SERVICE_ROLE_KEY) throw fail("Supabase storage is not configured.", 503);
  const headers = new Headers(options.headers);
  headers.set("apikey", env.SUPABASE_SERVICE_ROLE_KEY);
  if (!env.SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_secret_")) headers.set("Authorization", "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY);
  const timeout=path.startsWith("object/authenticated/") || (options.method==="POST" && path.startsWith("object/"+bucket+"/")) ? 120000 : 25000;
  try {
    return await fetch(origin + "/storage/v1/" + path, {...options, headers, redirect:"manual", signal:AbortSignal.timeout(timeout)});
  } catch { throw fail("Could not reach Supabase Storage. Retry the upload or check the connection.",503); }
}
async function privateBucket(env, increaseLimit=false) {
  const response = await storage(env, "bucket/" + bucket);
  const data = await response.json().catch(() => null);
  if(response.status===401 || response.status===403) throw fail("Supabase rejected the API key. Check SUPABASE_SERVICE_ROLE_KEY in Worker secrets.",503);
  if(!response.ok || !data) throw fail("Cannot find the monthly-asset-packs bucket in Supabase. Check the project URL and bucket name.",503);
  if(data.public !== false) throw fail("The monthly-asset-packs bucket must be private.",503);
  let limit=Number(data.file_size_limit)||null;
  if(increaseLimit && limit!==null && limit<MAX_PACK_BYTES){
    const payload={public:false,file_size_limit:MAX_PACK_BYTES};
    if(Array.isArray(data.allowed_mime_types))payload.allowed_mime_types=data.allowed_mime_types;
    const update=await storage(env,"bucket/"+bucket,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    if(!update.ok)throw fail("The Supabase bucket limit is below 25 MiB. In Storage settings increase the bucket and project upload limits to at least 25 MiB.",503);
    limit=MAX_PACK_BYTES;
  }
  return {limit};
}

// Only ten image members are accepted. Ordinary safe folder entries and filenames
// (including parentheses and Unicode) are supported without extracting the archive.
export function validateMonthlyZip(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 22 || bytes.length > MAX_PACK_BYTES) throw fail("Choose a ZIP file up to 25 MiB.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length-22; p >= Math.max(0, bytes.length-65557); p--) {
    if (v.getUint32(p,true)===0x06054b50 && p+22+v.getUint16(p+20,true)===bytes.length) {end=p;break;}
  }
  if(end<0 || v.getUint16(end+4,true)!==0 || v.getUint16(end+6,true)!==0 ||
    v.getUint16(end+8,true)!==v.getUint16(end+10,true)) throw fail("ZIP directory is invalid.");
  const entries=v.getUint16(end+10,true);
  if(entries<10||entries>40)throw fail("ZIP must contain exactly ten image files and only optional folders.");
  const start=v.getUint32(end+16,true), size=v.getUint32(end+12,true);
  if(start+size!==end) throw fail("ZIP directory is invalid.");
  let p=start; let totalUnpacked=0,images=0; const names=new Set(),offsets=new Set();
  for(let i=0;i<entries;i++){
    if(p+46>end || v.getUint32(p,true)!==0x02014b50) throw fail("ZIP directory is invalid.");
    const flags=v.getUint16(p+8,true), method=v.getUint16(p+10,true);
    const packed=v.getUint32(p+20,true), unpacked=v.getUint32(p+24,true), nameLen=v.getUint16(p+28,true);
    const extra=v.getUint16(p+30,true), comment=v.getUint16(p+32,true), local=v.getUint32(p+42,true);
    const mode=(v.getUint32(p+38,true)>>>16)&0xF000;
    if(p+46+nameLen+extra+comment>end || flags&1 || ![0,8].includes(method) ||
      packed===0xffffffff || unpacked===0xffffffff || local+30>start || v.getUint32(local,true)!==0x04034b50 ||
      offsets.has(local) || (mode!==0 && mode!==0x8000 && mode!==0x4000)) throw fail("ZIP contains an invalid, encrypted, or unsupported entry.");
    offsets.add(local);
    const name=new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(p+46,p+46+nameLen));
    const directory=name.endsWith("/");
    const parts=(directory?name.slice(0,-1):name).split("/");
    if(!name || name.length>240 || /[\\:\u0000-\u001f\u007f]/.test(name) ||
      parts.some(part=>!part || part==="." || part===".." || part.trim()!==part || part.endsWith(".")) ||
      names.has(name.toLowerCase()))throw fail("ZIP contains an unsafe or duplicate filename.");
    const localName=v.getUint16(local+26,true), localExtra=v.getUint16(local+28,true);
    if(local+30+localName+localExtra+packed>start ||
      new TextDecoder().decode(bytes.subarray(local+30,local+30+localName))!==name) throw fail("ZIP file entry is invalid.");
    if(directory){
      if(unpacked!==0 || packed>8)throw fail("ZIP folder entry is invalid.");
    }else{
      if(mode===0x4000 || !packed || !unpacked || !/\.(jpg|jpeg|png|webp)$/i.test(name))throw fail("ZIP must contain only JPG, PNG or WebP images and optional folders.");
      images++;totalUnpacked+=unpacked;
      if(unpacked>40*1024*1024 || totalUnpacked>100*1024*1024) throw fail("Uncompressed images are too large.");
    }
    names.add(name.toLowerCase()); p+=46+nameLen+extra+comment;
  }
  if(p!==end || images!==10)throw fail("ZIP must contain exactly ten distinct image files.");
  return 10;
}
async function boundedBytes(request, limit) {
  const declared=Number(request.headers.get("Content-Length"));
  if(declared>limit) throw fail("File or request is too large.",413);
  const reader=request.body?.getReader();
  if(!reader) throw fail("Request is empty.");
  const expected=Number.isSafeInteger(declared)&&declared>0 ? new Uint8Array(declared) : null;
  const chunks=[];let total=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;
      if(total>limit){await reader.cancel();throw fail("File or request is too large.",413);}
      if(expected){if(total>expected.length){await reader.cancel();throw fail("Request length does not match the file.");}expected.set(value,total-value.byteLength);}
      else chunks.push(value);}
  }finally{reader.releaseLock();}
  if(expected){if(total!==expected.length)throw fail("Request length does not match the file.");return expected;}
  const bytes=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes;
}

function checkZip(bytes) {
  try { return validateMonthlyZip(bytes); }
  catch(error){if(error?.status)throw error;throw fail("The ZIP directory could not be read.");}
}
async function getStoredZip(env, objectPath) {
  const response=await storage(env,"object/authenticated/"+bucket+"/"+objectPath);
  if(!response.ok)throw fail("No readable "+objectPath+" was found in the private bucket.",409);
  return boundedBytes(response,MAX_PACK_BYTES);
}
async function equalZip(a,b) {
  if(a.byteLength!==b.byteLength)return false;
  const checks=await Promise.all([crypto.subtle.digest("SHA-256",a),crypto.subtle.digest("SHA-256",b)]);
  return new Uint8Array(checks[0]).every((byte,i)=>byte===new Uint8Array(checks[1])[i]);
}
export async function uploadMonthlyPack(request, env) {
  const month=request.headers.get("X-Pack-Month")||"";
  if(!monthPattern.test(month)) throw fail("Select the pack month in YYYY-MM format.");
  const recover=request.headers.get("X-Register-Existing")==="true";
  if (!recover && request.headers.get("Content-Type")?.split(";")[0] !== "application/zip") throw fail("Upload a ZIP file.");
  const objectPath=month+".zip";
  if(await sql(env,"SELECT pack_month FROM monthly_asset_packs WHERE pack_month=?",month).first()) throw fail("This month is already published. See Published packs below.",409);
  await privateBucket(env,!recover);
  let bytes;
  if(recover){
    bytes=await getStoredZip(env,objectPath);
    checkZip(bytes);
  }else{
    bytes=await boundedBytes(request,MAX_PACK_BYTES);
    checkZip(bytes);
    const result=await storage(env,"object/"+bucket+"/"+objectPath,{method:"POST",headers:{"Content-Type":"application/zip","x-upsert":"false"},body:bytes});
    if(!result.ok){
      const detail=await result.json().catch(()=>({}));
      const duplicate=result.status===409 || /duplicate|already.exists/i.test(String(detail?.error||"")+" "+String(detail?.message||""));
      if(duplicate){
        const stored=await getStoredZip(env,objectPath);
        if(!await equalZip(bytes,stored))throw fail("A different ZIP already exists for this month. Use Register existing ZIP only if it is the intended pack.",409);
      }else if(result.status===413 || /size|too.large/i.test(String(detail?.message||""))){
        throw fail("Supabase rejected the size. Check the project's Storage global and bucket limits (at least 25 MiB).",413);
      }else if(result.status===401 || result.status===403){
        throw fail("Supabase rejected the upload credentials. Check the project's server key.",503);
      }else{
        throw fail("Supabase upload was unsuccessful (HTTP "+result.status+"). Check Storage settings.",503);
      }
    }
  }
  const result=await sql(env,"INSERT INTO monthly_asset_packs (pack_month,object_path,byte_size,uploaded_at) VALUES (?,?,?,?) ON CONFLICT(pack_month) DO NOTHING",month,objectPath,bytes.length,epoch()).run();
  if(result.meta.changes===0)throw fail("This month is already published. See Published packs below.",409);
  await sql(env,"UPDATE monthly_asset_deliveries SET retry_at=0 WHERE pack_month=? AND state IN ('pending','waiting')",month).run();
  return {month,images:10,bytes:bytes.length,recovered:recover};
}

async function storageInventory(env) {
  // Root-only listing for the dedicated private monthly bucket. No signed URLs,
  // file contents, other buckets, or legacy database records are returned.
  const response=await storage(env,"object/list/"+bucket,{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({prefix:"",limit:100,offset:0,sortBy:{column:"name",order:"desc"}})});
  const data=await response.json().catch(()=>null);
  if(!response.ok || !Array.isArray(data))throw fail("Could not list files in the private monthly bucket.",503);
  const records=(await sql(env,"SELECT pack_month FROM monthly_asset_packs").all()).results;
  const registered=new Set(records.map(row=>row.pack_month+".zip"));
  const files=data.filter(row=>typeof row?.name==="string"&&row.name.length<=240).map(row=>{
    const month=row.name.endsWith(".zip")?row.name.slice(0,-4):"";
    const monthly=monthPattern.test(month) && row.id!==null && row.metadata!=null;
    const size=Number(row.metadata?.size);
    return {name:row.name,month:monthly?month:null,bytes:Number.isSafeInteger(size)&&size>=0?size:null,
      status:monthly?(registered.has(row.name)?"published":"unregistered"):"other"};
  });
  const present=new Set(files.filter(row=>row.month).map(row=>row.name));
  // When the result hits the page limit, do not falsely mark an older file missing.
  const missing=data.length<100?[...registered].filter(name=>!present.has(name)):[];
  return {ok:true,files,missing,partial:data.length>=100};
}

export async function monthlyStatus(env) {
  const config=deliveryConfiguration(env);
  const packs=(await sql(env,"SELECT pack_month,byte_size,uploaded_at FROM monthly_asset_packs ORDER BY pack_month DESC LIMIT 12").all()).results;
  const deliveries=(await sql(env,"SELECT invoice_id,buyer_email,pack_month,state,attempts,sent_at,last_error FROM monthly_asset_deliveries ORDER BY paid_at DESC LIMIT 50").all()).results;
  const counts=(await sql(env,"SELECT state,COUNT(*) AS count FROM monthly_asset_deliveries GROUP BY state").all()).results;
  let storageCheck={ok:false,message:"Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Cloudflare."};
  if(config.storage){
    try {
      const result=await privateBucket(env);
      storageCheck={ok:true,message:result.limit!==null && result.limit<MAX_PACK_BYTES ? "Private bucket connected; limit will be raised to 25 MiB when you upload." : "Private bucket connected; ready for ZIP upload."};
    }catch(error){storageCheck={ok:false,message:error?.error||"Could not verify Supabase Storage."};}
  }
  let inventory={ok:false,files:[],missing:[],message:"Connect the private bucket to inspect stored files."};
  if(storageCheck.ok){
    try {inventory=await storageInventory(env);}
    catch(error){inventory.message=error?.error||"Storage inventory could not be read.";}
  }
  return {config,packs,deliveries,counts,storageCheck,inventory};
}

async function verifiedEvent(request, secret, now) {
  const header=request.headers.get("Stripe-Signature")||"";
  const fields=header.split(",").map(x=>x.split("="));
  const stamp=fields.find(([k])=>k==="t")?.[1]||"";
  const signatures=fields.filter(([k,v])=>k==="v1"&&/^[a-f0-9]{64}$/i.test(v||"")).map(([,v])=>v.toLowerCase());
  if(!/^\d{10}$/.test(stamp)||Math.abs(now-Number(stamp))>300||!signatures.length) throw fail("Invalid Stripe signature.");
  const raw=await boundedBytes(request,256*1024);
  const prefix=new TextEncoder().encode(stamp+".");
  const message=new Uint8Array(prefix.length+raw.length);message.set(prefix);message.set(raw,prefix.length);
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  let valid=false;
  for(const signature of signatures){const bytes=Uint8Array.from(signature.match(/../g),h=>parseInt(h,16));if(await crypto.subtle.verify("HMAC",key,bytes,message)) valid=true;}
  if(!valid) throw fail("Invalid Stripe signature.");
  try{return JSON.parse(new TextDecoder().decode(raw));}catch{throw fail("Invalid Stripe event.");}
}

export async function acceptMonthlyInvoice(request, env, now=epoch()) {
  if(!env.STRIPE_MONTHLY_WEBHOOK_SECRET || !env.CAMPAIGN_DB || !env.CAMPAIGN_MONTHLY_PRICE_ID) throw fail("Monthly webhook is not configured.",503);
  const event=await verifiedEvent(request,env.STRIPE_MONTHLY_WEBHOOK_SECRET,now);
  // Never fulfill synthetic/test Stripe events, even with a valid signature.
  if(event.type!=="invoice.paid" || event.livemode!==true) return {ignored:true};
  const invoice=event.data?.object;
  if(!invoice || invoice.object!=="invoice" || invoice.livemode!==true || invoice.status!=="paid" ||
    !["subscription_create","subscription_cycle"].includes(invoice.billing_reason) ||
    invoice.currency!=="usd" || !Number.isSafeInteger(invoice.amount_paid) || invoice.amount_paid<4900 || !safeId(invoice.id,"in")) return {ignored:true};
  const subscription=invoice.parent?.subscription_details?.subscription ?? invoice.subscription;
  if(!safeId(subscription,"sub")) return {ignored:true};
  const lines=invoice.lines?.data;
  if(!Array.isArray(lines)) throw fail("Invoice lines are missing.",422);
  const matched=lines.find(line=>(line.pricing?.price_details?.price ?? line.price?.id)===env.CAMPAIGN_MONTHLY_PRICE_ID &&
    line.quantity===1 && line.amount===4900 && !(line.parent?.subscription_item_details?.proration ?? line.proration));
  if(!matched){if(invoice.lines.has_more)throw fail("Invoice lines need review.",422);return {ignored:true};}
  const email=invoice.customer_email;
  const start=matched.period?.start;
  if(typeof email!=="string"||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!Number.isSafeInteger(start)||start<0||start>now+86400) throw fail("Paid invoice requires review.",422);
  const month=new Date(start*1000).toISOString().slice(0,7);
  if(!monthPattern.test(month))throw fail("Invoice month is invalid.",422);
  const result=await sql(env,`INSERT INTO monthly_asset_deliveries (invoice_id,subscription_id,buyer_email,pack_month,paid_at)
    VALUES (?,?,?,?,?) ON CONFLICT(invoice_id) DO NOTHING`,invoice.id,subscription,email,month,now).run();
  return {queued:result.meta.changes===1};
}
async function signPack(env,objectPath) {
  const result=await storage(env,"object/sign/"+bucket+"/"+objectPath,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expiresIn:86400})});
  const data=await result.json().catch(()=>null);
  if(!result.ok || typeof data?.signedURL!=="string") throw new Error("Private ZIP cannot be signed.");
  const origin=supabaseOrigin(env);
  const url=new URL(data.signedURL.startsWith("/object/")?"/storage/v1"+data.signedURL:data.signedURL,origin);
  if(url.origin!==origin||!url.pathname.startsWith("/storage/v1/object/sign/"+bucket+"/")||!url.searchParams.has("token"))throw new Error("Invalid storage link.");
  return url.href;
}
async function update(env,id,state,retry,error) {
  await sql(env,"UPDATE monthly_asset_deliveries SET state=?,retry_at=?,lease_until=0,last_error=? WHERE invoice_id=? AND state='sending'",state,retry,error,id).run();
}

export async function deliverMonthlyQueue(env, now=epoch()) {
  if(!ready(env))return {configured:false,sent:0};
  const candidates=(await sql(env,`SELECT invoice_id FROM monthly_asset_deliveries
    WHERE ((state IN ('pending','waiting') AND retry_at<=?) OR (state='sending' AND lease_until<=?))
    ORDER BY paid_at LIMIT 4`,now,now).all()).results;
  if(!candidates.length)return {configured:true,sent:0};
  await privateBucket(env);
  let sent=0;
  for(const candidate of candidates){
    const job=await sql(env,`UPDATE monthly_asset_deliveries SET state='sending',lease_until=?,attempts=attempts+1
      WHERE invoice_id=? AND ((state IN ('pending','waiting') AND retry_at<=?) OR (state='sending' AND lease_until<=?))
      RETURNING *`,now+300,candidate.invoice_id,now,now).first();
    if(!job)continue;
    try{
      let payload=job.send_payload;
      if(job.first_attempt && now-job.first_attempt>=23*3600){
        await update(env,job.invoice_id,"review",0,"Delivery outcome needs review before resending.");continue;
      }
      if(!payload){
        const pack=await sql(env,"SELECT object_path FROM monthly_asset_packs WHERE pack_month=?",job.pack_month).first();
        if(!pack){await update(env,job.invoice_id,"waiting",now+300,"Waiting for the monthly ZIP.");continue;}
        const url=await signPack(env,pack.object_path);
        payload=JSON.stringify({
          from:env.RESEND_FROM_EMAIL,to:[job.buyer_email],
          subject:"Pixel Shroom Studio | Your "+job.pack_month+" Monthly Asset Pack",
          text:"Thank you for subscribing to Pixel Shroom Studio! Your ten fresh, randomly themed backgrounds are attached as a ZIP. Manage your subscription at "+env.CAMPAIGN_BILLING_PORTAL_URL+".",
          attachments:[{filename:"Pixel-Shroom-Monthly-Asset-Pack-"+job.pack_month+".zip",path:url}]
        });
        // Save the exact payload before sending so ambiguous retries have identical bytes.
        await sql(env,"UPDATE monthly_asset_deliveries SET send_payload=?,first_attempt=? WHERE invoice_id=? AND state='sending'",payload,now,job.invoice_id).run();
      }
      const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json","Idempotency-Key":"monthly-pack/"+job.invoice_id},body:payload,signal:AbortSignal.timeout(25000),redirect:"manual"});
      const result=await response.json().catch(()=>null);
      if(response.ok && typeof result?.id==="string"){
        await sql(env,"UPDATE monthly_asset_deliveries SET state='sent',provider_id=?,sent_at=?,send_payload=NULL,lease_until=0,last_error=NULL WHERE invoice_id=? AND state='sending'",result.id,now,job.invoice_id).run();sent++;
      }else if(response.status===429||response.status>=500||response.ok){
        await update(env,job.invoice_id,"pending",now+300,"Email provider temporarily unavailable. Retrying.");
      }else{
        await update(env,job.invoice_id,"review",0,"Email provider rejected the request. Check Resend before any resend.");
      }
    }catch{
      await update(env,job.invoice_id,"pending",now+300,"Storage or email connection unavailable. Retrying.");
    }
  }
  return {configured:true,sent};
}
