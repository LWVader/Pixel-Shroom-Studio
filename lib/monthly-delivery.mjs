const bucket = "monthly-asset-packs";
export const MAX_PACK_BYTES = 20 * 1024 * 1024;
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
  headers.set("Authorization", "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY);
  return fetch(origin + "/storage/v1/" + path, {...options, headers, redirect:"manual", signal:AbortSignal.timeout(25000)});
}
async function privateBucket(env) {
  const response = await storage(env, "bucket/" + bucket);
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.public !== false) throw fail("Create a private Supabase bucket named monthly-asset-packs.", 503);
}

// Inspect the ZIP directory without extracting files. Only ten unique, flat image entries
// are accepted; oversized, encrypted, ZIP64 or path-containing archives are rejected.
export function validateMonthlyZip(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 22 || bytes.length > MAX_PACK_BYTES) throw fail("Choose a ZIP file up to 20 MB.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length-22; p >= Math.max(0, bytes.length-65557); p--) {
    if (v.getUint32(p,true)===0x06054b50 && p+22+v.getUint16(p+20,true)===bytes.length) {end=p;break;}
  }
  if(end<0 || v.getUint16(end+4,true)!==0 || v.getUint16(end+6,true)!==0 ||
    v.getUint16(end+8,true)!==10 || v.getUint16(end+10,true)!==10) throw fail("ZIP must contain exactly ten image files, with no folders or extra files.");
  const start=v.getUint32(end+16,true), size=v.getUint32(end+12,true);
  if(start+size!==end) throw fail("ZIP directory is invalid.");
  let p=start; let totalUnpacked=0; const names=new Set();
  for(let i=0;i<10;i++){
    if(p+46>end || v.getUint32(p,true)!==0x02014b50) throw fail("ZIP directory is invalid.");
    const flags=v.getUint16(p+8,true), method=v.getUint16(p+10,true);
    const packed=v.getUint32(p+20,true), unpacked=v.getUint32(p+24,true), nameLen=v.getUint16(p+28,true);
    const extra=v.getUint16(p+30,true), comment=v.getUint16(p+32,true), local=v.getUint32(p+42,true);
    if(p+46+nameLen+extra+comment>end || flags&1 || ![0,8].includes(method) || !packed || !unpacked ||
      packed===0xffffffff || unpacked===0xffffffff || local+30>start || v.getUint32(local,true)!==0x04034b50) throw fail("ZIP contains an invalid or encrypted entry.");
    totalUnpacked+=unpacked;
    if(unpacked>40*1024*1024 || totalUnpacked>100*1024*1024) throw fail("Uncompressed images are too large.");
    const name=new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(p+46,p+46+nameLen));
    if(!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,119}\.(?:jpg|jpeg|png|webp)$/i.test(name) || names.has(name.toLowerCase())) throw fail("Use ten distinct JPG, PNG or WebP files at the ZIP root.");
    const localName=v.getUint16(local+26,true), localExtra=v.getUint16(local+28,true);
    if(local+30+localName+localExtra+packed>start ||
      new TextDecoder().decode(bytes.subarray(local+30,local+30+localName))!==name) throw fail("ZIP file entry is invalid.");
    names.add(name.toLowerCase()); p+=46+nameLen+extra+comment;
  }
  if(p!==end) throw fail("ZIP directory is invalid.");
  return 10;
}
async function boundedBytes(request, limit) {
  const declared=Number(request.headers.get("Content-Length"));
  if(declared>limit) throw fail("File or request is too large.",413);
  const reader=request.body?.getReader();
  if(!reader) throw fail("Request is empty.");
  const chunks=[];let total=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;
      if(total>limit){await reader.cancel();throw fail("File or request is too large.",413);}
      chunks.push(value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes;
}

export async function uploadMonthlyPack(request, env) {
  const month=request.headers.get("X-Pack-Month")||"";
  if(!monthPattern.test(month)) throw fail("Select the pack month in YYYY-MM format.");
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/zip") throw fail("Upload a ZIP file.");
  await privateBucket(env);
  const bytes=await boundedBytes(request,MAX_PACK_BYTES);
  try{validateMonthlyZip(bytes);}catch(error){if(error?.status)throw error;throw fail("The ZIP directory could not be read.");}
  const objectPath=month+".zip";
  if(await sql(env,"SELECT pack_month FROM monthly_asset_packs WHERE pack_month=?",month).first()) throw fail("This month is already published.",409);
  const result=await storage(env,"object/"+bucket+"/"+objectPath,{method:"POST",headers:{"Content-Type":"application/zip","x-upsert":"false"},body:bytes});
  if(!result.ok) throw fail(result.status===409 || result.status===400 ? "Upload failed or this month already exists. Published packs are immutable." : "Supabase upload failed. Check the private bucket.",409);
  await sql(env,"INSERT INTO monthly_asset_packs (pack_month,object_path,byte_size,uploaded_at) VALUES (?,?,?,?)",month,objectPath,bytes.length,epoch()).run();
  // Make any previously paid invoices for this pack immediately eligible.
  await sql(env,"UPDATE monthly_asset_deliveries SET retry_at=0 WHERE pack_month=? AND state IN ('pending','waiting')",month).run();
  return {month,images:10,bytes:bytes.length};
}

export async function monthlyStatus(env) {
  const config=deliveryConfiguration(env);
  const packs=(await sql(env,"SELECT pack_month,byte_size,uploaded_at FROM monthly_asset_packs ORDER BY pack_month DESC LIMIT 12").all()).results;
  const deliveries=(await sql(env,"SELECT invoice_id,buyer_email,pack_month,state,attempts,sent_at,last_error FROM monthly_asset_deliveries ORDER BY paid_at DESC LIMIT 50").all()).results;
  const counts=(await sql(env,"SELECT state,COUNT(*) AS count FROM monthly_asset_deliveries GROUP BY state").all()).results;
  return {config,packs,deliveries,counts};
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
