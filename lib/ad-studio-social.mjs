import {BUFFER_VIDEO_TYPES, MAX_VIDEO_BYTES, BUFFER_IMAGE_TYPES, MAX_IMAGE_BYTES, captionLength, publicMediaUrl} from "../public/ad-studio-rules.mjs";

/* Buffer personal API integration. Credentials and submissions are isolated by Site identity. */
export const SOCIAL_PLATFORMS=[['instagram','Instagram'],['facebook','Facebook'],['tiktok','TikTok'],['youtube','YouTube'],['linkedin','LinkedIn'],['twitter','X'],['threads','Threads'],['pinterest','Pinterest'],['bluesky','Bluesky'],['mastodon','Mastodon'],['googlebusiness','Google Business']];
const supported=new Set(SOCIAL_PLATFORMS.map(x=>x[0]));
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const bytes=s=>Uint8Array.from(s.match(/../g)||[],x=>parseInt(x,16));
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
async function digest(value){return hex(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))}
const secureStorageReady = env => /^[a-f0-9]{64}$/i.test(env.BUFFER_CREDENTIAL_ENCRYPTION_KEY || "");
const validBufferKey = key => typeof key === "string" && key.length >= 12 && key.length <= 4000 && !/\s/.test(key);
async function cipherKey(env){if(!secureStorageReady(env))throw fail('Set BUFFER_CREDENTIAL_ENCRYPTION_KEY to a 64-character hexadecimal encryption key, or configure BUFFER_API_KEY on your Worker.',503);return crypto.subtle.importKey('raw',bytes(env.BUFFER_CREDENTIAL_ENCRYPTION_KEY),'AES-GCM',false,['encrypt','decrypt'])}
async function seal(value,user,env){const iv=crypto.getRandomValues(new Uint8Array(12)),data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(user)},await cipherKey(env),new TextEncoder().encode(JSON.stringify(value)));return hex(iv)+':'+hex(data)}
async function unseal(value,user,env){const[iv,data]=value.split(':');return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:new TextEncoder().encode(user)},await cipherKey(env),bytes(data))))}
export {publicMediaUrl};

function validatedMediaUrl(value, kind = "video") {
  try { return publicMediaUrl(value, kind); } catch (error) { throw fail(error.message); }
}

function cloudSettings(env, saved) {
  const {CLOUDINARY_CLOUD_NAME: name, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret} = env;
  if (/^[a-z0-9_-]{1,80}$/i.test(name || "") && /^\d{1,80}$/.test(key || "") && secret) {
    return {name, key, secret};
  }
  return saved;
}

async function signedUpload(cloud, kind = "video") {
  const fields = {overwrite: "false", public_id: "pss-ad-" + crypto.randomUUID(),
    timestamp: String(Math.floor(Date.now() / 1000))};
  const signature = await digest(new URLSearchParams(fields).toString() + cloud.secret);
  return {
    endpoint: "https://api.cloudinary.com/v1_1/" + encodeURIComponent(cloud.name) + "/" + kind + "/upload",
    fields: {...fields, api_key: cloud.key, signature}
  };
}

async function submissionHistory(request, db, user) {
  if (request.method === "POST") {
    const id = new URL(request.url).searchParams.get("id");
    if (!submissionIdPattern.test(id || "")) throw fail("A valid submission ID is required.");
    await db.prepare("UPDATE publishing_submissions SET result = json_set(result, '$.historyHidden', 1) WHERE id = ? AND user_id = ?")
      .bind(user + ":" + id, user).run();
    return json({hidden: true});
  }
  const {results} = await db.prepare(`SELECT result, created_at FROM publishing_submissions
    WHERE user_id = ? AND COALESCE(json_extract(result, '$.historyHidden'), 0) = 0
    ORDER BY created_at DESC LIMIT 30`).bind(user).all();
  return json({submissions: results.map(row => {
    const result = JSON.parse(row.result);
    return {id: result.requestId, title: result.title || "Buffer submission",
      status: result.status, dueAt: result.dueAt, created: row.created_at, mediaKind: result.mediaKind || 'video'};
  })});
}

const submissionIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const saveResultSql = "UPDATE publishing_submissions SET result = json_set(?, '$.historyHidden', COALESCE(json_extract(result, '$.historyHidden'), 0)) WHERE id = ? AND user_id = ?";

async function bufferApi(key,query,variables,fetcher){let r;try{r=await fetcher('https://api.buffer.com',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({query,variables}),redirect:'manual',signal:AbortSignal.timeout(45000)})}catch{throw fail('Buffer could not be reached. Check your Buffer dashboard before retrying.',502)}let body;try{body=await r.json()}catch{throw fail('Buffer returned an unreadable response.',502)}if(!r.ok||body.errors?.length)throw fail(r.status===401||r.status===403?'Buffer rejected the key or its permissions. Check API scopes.':'Buffer rejected the request. Check your account, API permissions and plan limits.',502);return body.data}
async function channelsFor(key,fetcher){const d=await bufferApi(key,'query { account { organizations { id name } } }',{},fetcher),out=[];for(const org of d.account?.organizations||[]){const data=await bufferApi(key,'query($input:ChannelsInput!){ channels(input:$input){ id name displayName service isDisconnected isLocked isQueuePaused } }',{input:{organizationId:org.id}},fetcher);for(const c of data.channels||[])out.push({id:c.service,accountId:c.id,name:SOCIAL_PLATFORMS.find(p=>p[0]===c.service)?.[1]||c.service,label:c.displayName||c.name,organization:org.name,connected:!c.isDisconnected&&!c.isLocked&&supported.has(c.service),reauth:c.isDisconnected,locked:c.isLocked,paused:c.isQueuePaused})}return out}
export function hostingFailure(status,detail,cloud){
let message=typeof detail==='string'?detail:'No additional details were returned.';
for(const secret of [cloud?.secret,cloud?.key,cloud?.secret&&cloud?.key?btoa(cloud.key+':'+cloud.secret):null])if(secret)message=message.split(secret).join('[redacted]');
message=message.replace(/https?:\/\/\S+/gi,'[URL omitted]').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,350);
const hint=status===401||status===403?'Check that Cloud name, API key and API secret belong to the same Cloudinary product environment.':status===413?'The video exceeds Cloudinary’s upload limit.':status===429?'Cloudinary is limiting requests. Wait before retrying.':/quota|limit|credits|disabled/i.test(message)?'Check usage and account status in your Cloudinary dashboard.':'Check the Cloudinary error below before retrying.';
return `Cloudinary upload failed (HTTP ${status}). ${hint} Details: ${message}`;
}
async function uploadMedia(file,cloud,fetcher,kind="video"){
if(!cloud?.name||!cloud?.key||!cloud?.secret)throw fail('Connect media hosting or supply a public media URL.',409);
const form=new FormData();form.append('file',file,file.name||(kind==='image'?'campaign-ad.png':'popout-ad.mp4'));
let r;try{r=await fetcher('https://api.cloudinary.com/v1_1/'+encodeURIComponent(cloud.name)+'/'+kind+'/upload',{method:'POST',headers:{Authorization:'Basic '+btoa(cloud.key+':'+cloud.secret)},body:form,redirect:'manual',signal:AbortSignal.timeout(55000)})}catch(error){throw fail(error?.name==='TimeoutError'||error?.name==='AbortError'?'Cloudinary upload timed out. No post was sent to Buffer. Try a smaller video or retry once your connection is stable.':'Cloudinary could not be reached. No post was sent to Buffer. Try again when your connection is stable.',502)}
let data;try{data=await r.json()}catch{throw fail(`Cloudinary returned an unreadable response (HTTP ${r.status}). No post was sent to Buffer.`,502)}
if(!r.ok||!data.secure_url)throw fail(hostingFailure(r.status,data.error?.message,cloud),502);
let hosted;try{hosted=new URL(data.secure_url)}catch{throw fail('Cloudinary returned an invalid video URL.',502)}
if(hosted.hostname!=='res.cloudinary.com')throw fail('Media hosting returned an unexpected URL.',502);return validatedMediaUrl(data.secure_url,kind)
}
// Preserve the original AD Studio database if it is configured. When the
// storefront's existing campaign database is used, initialize only these
// publishing tables; never modify or delete campaign or subscription records.
async function ensurePublishingSchema(db) {
  try {
    await db.prepare("SELECT user_id, encrypted FROM publishing_credentials LIMIT 0").bind().all();
    await db.prepare("SELECT id, user_id, result FROM publishing_submissions LIMIT 0").bind().all();
  } catch (error) {
    if (!/no such table:\s*(?:main\.)?publishing_(credentials|submissions)/i.test(String(error?.message || error)))
      throw fail("Publishing database is unavailable. Check the D1 binding.", 503);
    try {
      await db.prepare("CREATE TABLE IF NOT EXISTS publishing_credentials (user_id TEXT PRIMARY KEY NOT NULL, encrypted TEXT NOT NULL, updated_at TEXT NOT NULL)").bind().run();
      await db.prepare("CREATE TABLE IF NOT EXISTS publishing_submissions (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, payload_hash TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL)").bind().run();
    } catch {
      throw fail("Publishing database could not initialize. Check the D1 binding and migration.", 503);
    }
  }
}

export async function handleSocial(request, env, action, fetcher = fetch) {
  const user = request.headers.get("oai-authenticated-user-id");
  if (!user) return json({error: "Sign in to use publishing."}, 401);
  const url = new URL(request.url), write = request.method === "POST";
  if (write && request.headers.get("Origin") !== url.origin) return json({error: "Same-origin requests required."}, 403);
  const methods = {config: ["GET"], status: ["GET"], history: ["GET", "POST"],
    connect: ["POST"], publish: ["POST"], "upload-ticket": ["POST"]};
  if (!Object.hasOwn(methods, action)) return json({error: "Unknown endpoint."}, 404);
  if (!methods[action].includes(request.method)) return json({error: "Method not allowed."}, 405);
  if (!env.DB) return json({error: "Publishing storage is unavailable."}, 503);
  try {
    await ensurePublishingSchema(env.DB);
    if (action === "history") return await submissionHistory(request, env.DB, user);
    const row = await env.DB.prepare("SELECT encrypted FROM publishing_credentials WHERE user_id = ?").bind(user).first();
    const secureStorage = secureStorageReady(env);
    let saved = {}, unreadable = false;
    if (row) {
      try { saved = await unseal(row.encrypted, user, env); }
      catch { unreadable = true; }
    }
    // BUFFER_CREDENTIAL_ENCRYPTION_KEY is never sent to Buffer. It is only
    // used to encrypt/decrypt credentials, not as a bearer token.
    const managed = typeof env.BUFFER_API_KEY === "string" && env.BUFFER_API_KEY.trim() !== "";
    const credentials = {...saved, bufferKey: managed ? env.BUFFER_API_KEY.trim() : saved.bufferKey};
    const cloud = cloudSettings(env, credentials.cloud);
    if (action === "upload-ticket") {
      if (!validBufferKey(credentials.bufferKey) || !cloud) throw fail("Connect Buffer and configure Cloudinary first.", 409);
      const kind = url.searchParams.get("kind") || "video";
      if (!["image", "video"].includes(kind)) throw fail("Unsupported upload type.");
      return json(await signedUpload(cloud, kind));
    }
    if (action === "connect") {
      if (managed) throw fail("Buffer is managed by BUFFER_API_KEY on the Worker. Update that secret and refresh accounts.", 409);
      if (!secureStorage) throw fail("Set BUFFER_CREDENTIAL_ENCRYPTION_KEY to a 64-character hexadecimal encryption key, or configure BUFFER_API_KEY on your Worker.", 503);
      if (Number(request.headers.get("Content-Length") || 0) > 12000) throw fail("Connection form is too large.", 413);
      const input = await request.json();
      if (input.bufferKey !== undefined) {
        if (!validBufferKey(input.bufferKey)) throw fail("Enter your personal Buffer API key.");
        await channelsFor(input.bufferKey, fetcher);
        credentials.bufferKey = input.bufferKey;
      }
      if (input.cloud) {
        const c = input.cloud;
        if (!/^[a-z0-9_-]{1,80}$/i.test(c.name || "") || !/^\d{1,80}$/.test(c.key || "") || typeof c.secret !== "string" || c.secret.length < 8 || c.secret.length > 500) throw fail("Enter valid media-hosting credentials.");
        credentials.cloud = {name: c.name, key: c.key, secret: c.secret};
      }
      if (!validBufferKey(credentials.bufferKey)) throw fail("Enter your personal Buffer API key.");
      // Do not replace an unreadable record until a new key validates.
      await env.DB.prepare("INSERT INTO publishing_credentials (user_id, encrypted, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET encrypted=excluded.encrypted, updated_at=excluded.updated_at")
        .bind(user, await seal(credentials, user, env), new Date().toISOString()).run();
      return json({connected: true});
    }
    if (action === "config") {
      let platforms = [], accountsError = null, bufferNeedsUpdate = false;
      const configured = validBufferKey(credentials.bufferKey);
      if (configured) {
        try { platforms = await channelsFor(credentials.bufferKey, fetcher); }
        catch (error) {
          accountsError = error.message;
          bufferNeedsUpdate = /rejected the key or its permissions/.test(error.message);
        }
      } else if (managed) {
        accountsError = "BUFFER_API_KEY is not a valid personal Buffer API key. Update the Worker secret.";
        bufferNeedsUpdate = true;
      } else if (unreadable) {
        accountsError = "The saved Buffer credential could not be unlocked. Restore the original encryption key or reconnect using your personal Buffer API key.";
        bufferNeedsUpdate = true;
      } else if (!secureStorage) {
        accountsError = "Buffer connection storage needs a 64-character hexadecimal BUFFER_CREDENTIAL_ENCRYPTION_KEY, or a dedicated BUFFER_API_KEY secret.";
      }
      const cloudVars = ["CLOUDINARY_CLOUD_NAME","CLOUDINARY_API_KEY","CLOUDINARY_API_SECRET"];
      const cloudinaryMissing = cloudVars.filter(name=>!String(env[name]||"").trim());
      const cloudinaryInvalid = cloudVars.filter(name=>!cloudinaryMissing.includes(name)&&((name==="CLOUDINARY_CLOUD_NAME"&&!/^[a-z0-9_-]{1,80}$/i.test(env[name]))||(name==="CLOUDINARY_API_KEY"&&!/^\d{1,80}$/.test(env[name]))));
      return json({configured, provider: "Buffer", cloudinaryMissing, cloudinaryInvalid, bufferSource: managed ? "worker" : configured ? "saved" : null,
        uploadReady: !!cloud, uploadMode: cloud ? (cloud === credentials.cloud ? "legacy" : "direct") : null,
        secureStorage, platforms, accountsError, bufferNeedsUpdate});
    }
if(!validBufferKey(credentials.bufferKey))throw fail('Connect your personal Buffer API key first.',409);
const clientId=action==='publish'?request.headers.get('Idempotency-Key'):url.searchParams.get('id');if(!submissionIdPattern.test(clientId||''))throw fail('A valid submission ID is required.');const id=user+':'+clientId;
if(action==='status'){const record=await env.DB.prepare('SELECT result FROM publishing_submissions WHERE id = ? AND user_id = ?').bind(id,user).first();if(!record)throw fail('No Buffer submission found for this account.',404);const result=JSON.parse(record.result);for(const target of result.results||[]){if(!target.postId)continue;try{const d=await bufferApi(credentials.bufferKey,'query($input:PostInput!){post(input:$input){id status}}',{input:{id:target.postId}},fetcher);target.status=d.post.status}catch{target.message='Could not refresh status; check Buffer.'}}if(result.results?.length)result.status=result.results.every(t=>t.status==='sent')?'published':result.results.some(t=>t.status==='unconfirmed')?'unconfirmed':result.results.every(t=>t.status==='error')?'failed':'submitted';await env.DB.prepare(saveResultSql).bind(JSON.stringify(result),id,user).run();return json(result)}
if(Number(request.headers.get('Content-Length')||0)>18*1024*1024)throw fail('Maximum video size is 16 MB.',413);const form=await request.formData(),title=String(form.get('title')||'').trim(),caption=String(form.get('caption')||'').trim(),mode=String(form.get('mode')||'addToQueue');if(!title||title.length>100||caption.length>25000||!['addToQueue','shareNow','customScheduled'].includes(mode))throw fail('Check title, caption and publishing mode.');let dueAt=null;if(mode==='customScheduled'){const value=String(form.get('dueAt')||'');if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||Date.parse(value)<Date.now()+120000)throw fail('Choose a valid posting time at least 2 minutes in the future.');dueAt=new Date(value).toISOString()}let targets;try{targets=JSON.parse(String(form.get('targets')||'[]'))}catch{throw fail('Invalid destination selection.')}if(!Array.isArray(targets)||!targets.length||targets.length>20||targets.some(t=>!t||typeof t.accountId!=='string'||!supported.has(t.platform))||new Set(targets.map(t=>t.accountId)).size!==targets.length)throw fail('Select up to 20 distinct connected channels.');const channels=await channelsFor(credentials.bufferKey,fetcher);for(const t of targets){const channel=channels.find(c=>c.accountId===t.accountId&&c.id===t.platform);if(!channel?.connected)throw fail('A channel changed or disconnected. Refresh your accounts.',409);if(mode==='addToQueue'&&channel.paused)throw fail('A selected Buffer queue is paused. Resume it in Buffer or choose Publish now.',409)}
const mediaKind = String(form.get("mediaKind") || "video");
if (!["video", "image", "text"].includes(mediaKind)) throw fail("Choose a supported post type.");
if (mediaKind !== "video" && targets.some(t => !["facebook", "linkedin"].includes(t.platform))) throw fail("Static posts are available for Facebook and LinkedIn.");
const board=String(form.get('pinterestBoard')||'').trim();if(targets.some(t=>t.platform==='pinterest')&&!board)throw fail('Choose a Pinterest board ID before publishing.');
let media=String(form.get('mediaUrl')||'').trim(),file=form.get(mediaKind === "image" ? "image" : "video");
if (mediaKind === "text") {
  if (media || form.has("image") || form.has("video")) throw fail("Text-only posts cannot include media.");
} else if (media) {
  media = validatedMediaUrl(media, mediaKind);
} else {
  const maxBytes = mediaKind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  const types = mediaKind === "image" ? BUFFER_IMAGE_TYPES : BUFFER_VIDEO_TYPES;
  if (!file || typeof file === "string" || !file.size || file.size > maxBytes || !types.includes(file.type.split(";")[0]))
    throw fail(mediaKind === "image" ? "Use a PNG/JPEG image under 10 MB or enter a public image URL." : "Buffer needs MP4/MOV. Use a compatible browser, upload an MP4, or enter a public MP4 URL.");
  if (!cloud) throw fail(mediaKind === "image" ? "Connect media hosting or enter a public PNG/JPEG URL." : "Connect media hosting or enter a public MP4 URL.", 409);
}
let captions;
try { captions = JSON.parse(String(form.get("captions") || "{}")); } catch { throw fail("Invalid caption overrides."); }
if (!captions || typeof captions !== "object" || Array.isArray(captions) ||
    Object.entries(captions).some(([platform, text]) => !supported.has(platform) || typeof text !== "string" || text.length > 25000)) {
  throw fail("Invalid caption overrides.");
}
const captionFor = platform => (Object.hasOwn(captions, platform) ? captions[platform].trim() : "") || caption || title;
for (const {platform} of targets) {
  const {count, limit} = captionLength(platform, captionFor(platform));
  if (limit && count > limit) throw fail((SOCIAL_PLATFORMS.find(([id]) => id === platform)?.[1] || platform) +
    " captions must be " + limit + " characters or fewer.");
}
const videoHash=mediaKind==="text"?"":media||await digest(await file.arrayBuffer());const payloadHash=await digest(JSON.stringify({title,caption,targets,mode,dueAt,videoHash,board,...(mediaKind==="video"?{}:{mediaKind}),...(Object.keys(captions).length?{captions}:{}),privacy:form.get('youtubePrivacy'),ai:form.get('aiGenerated')}));const old=await env.DB.prepare('SELECT payload_hash, result FROM publishing_submissions WHERE id = ? AND user_id = ?').bind(id,user).first();if(old){if(old.payload_hash!==payloadHash)throw fail('This submission ID belongs to different content.',409);return json(JSON.parse(old.result))}
const result={status:'submitting',title,requestId:clientId,dueAt,mediaKind,results:[],message:'Submission started. Check Buffer if processing is interrupted.'};const inserted=await env.DB.prepare('INSERT INTO publishing_submissions (id, user_id, payload_hash, result, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(id,user,payloadHash,JSON.stringify(result),new Date().toISOString()).run();if(!inserted.meta?.changes)throw fail('This submission is already processing. Check status.',409);
const save=()=>env.DB.prepare(saveResultSql).bind(JSON.stringify(result),id,user).run();
try{if(mediaKind!=="text"&&!media)media=await uploadMedia(file,cloud,fetcher,mediaKind);for(const t of targets){const input={...(dueAt?{dueAt}:{}),channelId:t.accountId,text:captionFor(t.platform),schedulingType:'automatic',mode,assets:mediaKind==="text"?[]:[{[mediaKind]:{url:media}}]},ai=form.get('aiGenerated')==='true';if(t.platform==='facebook')input.metadata={facebook:{type:mediaKind==='video'?'reel':'post'}};if(t.platform==='youtube')input.metadata={youtube:{title,categoryId:'24',privacy:['public','unlisted','private'].includes(form.get('youtubePrivacy'))?form.get('youtubePrivacy'):'public',isAiGenerated:ai}};if(t.platform==='pinterest')input.metadata={pinterest:{boardServiceId:board,title}};if(t.platform==='tiktok')input.metadata={tiktok:{isAiGenerated:ai}};if(t.platform==='twitter')input.metadata={twitter:{isAiGenerated:ai}};if(t.platform==='instagram')input.metadata={instagram:{type:'reel',shouldShareToFeed:true,isAiGenerated:ai}};
// Persist an uncertain marker BEFORE the mutation, preventing automatic duplicate retries.
const entry={platform:t.platform,accountId:t.accountId,status:'unconfirmed'};result.results.push(entry);await save();try{const d=await bufferApi(credentials.bufferKey,'mutation($input:CreatePostInput!){createPost(input:$input){... on PostActionSuccess{post{id status dueAt}} ... on MutationError{message}}}',{input},fetcher),post=d.createPost?.post;if(post){entry.postId=post.id;entry.status=post.status;if(post.dueAt)entry.dueAt=post.dueAt}else{entry.status='error';entry.message=String(d.createPost?.message||'Buffer rejected this channel. Check its format, permissions and caption requirements.').split(credentials.bufferKey).join('[redacted]').slice(0,350)}}catch{entry.status='unconfirmed';entry.message='Could not confirm this channel. Check Buffer before creating another submission.'}await save()}result.status=result.results.every(t=>t.status==='sent')?'published':result.results.some(t=>t.status==='unconfirmed')?'unconfirmed':result.results.every(t=>t.status==='error')?'failed':'submitted';result.message=mode==='customScheduled'?'Scheduled through Buffer for '+dueAt+'.':mode==='addToQueue'?'Sent to Buffer. Queued posts follow your channel schedules.':'Sent to Buffer for publishing. Check each channel result.';await save();return json(result,202)}catch(error){result.status='failed';result.message=error.message;await save();return json(result,502)}
}catch(error){return json({error:error.status?error.message:'Publishing request failed. Please refresh or reconnect your account.'},error.status||500)}}
