import {$, state, renderRevision, requestPreview, renderAnimation, renderStillImage} from "./app.js";
import {BUFFER_VIDEO_TYPES, MAX_VIDEO_BYTES, MAX_IMAGE_BYTES, captionLength, publicMediaUrl} from "../ad-studio-rules.mjs";

const SOCIAL_CATALOG=[['instagram','Instagram'],['facebook','Facebook'],['tiktok','TikTok'],['youtube','YouTube'],['linkedin','LinkedIn'],['twitter','X'],['threads','Threads'],['pinterest','Pinterest'],['bluesky','Bluesky'],['mastodon','Mastodon'],['googlebusiness','Google Business']];
let socialConfig = {configured: false, platforms: []};
const hostedVideos = new WeakMap();
let stillImage = null, stillRevision = null, stillUrl = null, capturingStill = false;
let preparedVideo = null, preparedRevision = null, videoUrl = null, posting = false, preparingVideo = false, submissions = [];
const groupSubmissions = new Map();
const publishGroups = [{key:"twitter", button:"sendSocialX", status:"xPublishReady"}, {key:"other", button:"sendSocial", status:"otherPublishReady"}];
const platformName = platform => SOCIAL_CATALOG.find(([id]) => id === platform)?.[1] || platform;
const selectedPlatforms = () => [...new Set(selectedAccounts().map(({platform}) => platform))];
const defaultCaption = () => $("publishCaption").value.trim() || $("publishTitle").value.trim();
const captionFor = platform => state.channelCaptions[platform]?.trim() || defaultCaption();

async function socialApi(action,options={}){const response=await fetch('/api/ad-studio/social/'+action,{credentials:'same-origin',...options});let data;try{data=await response.json()}catch{throw Error('Invalid publishing service response.')}if(!response.ok)throw Error(data.error||data.message||'Publishing request failed.');return data}
const selectedAccounts=()=>Array.from(document.querySelectorAll('[data-social-target]:checked')).map(x=>({platform:x.dataset.socialTarget,accountId:x.dataset.accountId}));
function localDateInput(date){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')+'T'+String(date.getHours()).padStart(2,'0')+':'+String(date.getMinutes()).padStart(2,'0')}
function scheduledDate(){const value=$('scheduledAt').value;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return null;const date=new Date(value);return Number.isFinite(date.getTime())&&localDateInput(date)===value?date:null}
function updateSchedule(){const mode=$('bufferMode').value,custom=mode==='customScheduled',date=scheduledDate(),valid=!!date&&date.getTime()>Date.now()+120000;$('customSchedule').hidden=!custom;$('scheduledAt').required=custom;$('scheduledAt').min=localDateInput(new Date(Date.now()+180000));$('scheduleTimezone').textContent='Times use '+Intl.DateTimeFormat().resolvedOptions().timeZone+' (this browser).';$('scheduleSummary').textContent=custom?(valid?'Scheduled for '+date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})+'. Buffer will publish at this time.':'Choose a valid time at least 2 minutes from now.'):mode==='shareNow'?'Buffer will start publishing as soon as you send.':'Buffer will use the next available slot in each channel’s existing schedule.';return !custom||valid}
function updateCaptionCount() {
  const raw = $("publishCaption").value;
  $("captionCount").textContent = raw.length.toLocaleString() + " / 25,000 draft characters";
  return selectedPlatforms().map(platform => ({platform, ...captionLength(platform, captionFor(platform))}));
}

function renderCaptionOverrides() {
  const container = $("captionOverrides");
  const platforms = selectedPlatforms();
  container.replaceChildren();
  $("captionOverridesSection").hidden = !platforms.length;
  for (const platform of platforms) {
    const label = document.createElement("label");
    label.textContent = platformName(platform) + " caption";
    const input = document.createElement("textarea");
    input.rows = 3;
    input.maxLength = 25000;
    input.placeholder = "Use the shared caption";
    input.value = state.channelCaptions[platform] || "";
    input.oninput = () => {
      state.channelCaptions[platform] = input.value;
      updatePublishSummary();
    };
    label.append(input);
    container.append(label);
  }
}
export function syncSocialCopy(){$('publishTitle').value=state.socialTitle||String(state.headline).slice(0,100);$('publishCaption').value=state.socialCaption||state.headline+'\n'+state.website;$('youtubePrivacy').value=state.youtubePrivacy||'public';$('pinterestBoard').value=state.pinterestBoard||'';$('aiGenerated').checked=state.aiGenerated!==false;updatePostPreview()}
function updatePostPreview(){$('postTitlePreview').textContent=$('publishTitle').value.trim()||state.headline;$('postCaptionPreview').textContent=$('publishCaption').value.trim()||state.headline+'\n'+state.website;$('postSettingsPreview').textContent='YouTube: '+$('youtubePrivacy').value+' · '+($('aiGenerated').checked?'AI imagery disclosed':'AI imagery disclosure off')+($('pinterestBoard').value?' · Pinterest board: '+$('pinterestBoard').value:'')}
function groupTargets(group, chosen = selectedAccounts()) {
  return chosen.filter(({platform}) => group === "twitter" ? platform === "twitter" : platform !== "twitter");
}
function submissionSnapshot(group, targets = groupTargets(group)) {
  // Capture only this group's destinations and effective caption overrides.
  const fields = Object.fromEntries(Object.entries({title: "publishTitle", caption: "publishCaption", mode: "bufferMode",
    youtubePrivacy: "youtubePrivacy", pinterestBoard: "pinterestBoard"}).map(([field, input]) => [field, $(input).value.trim()]));
  const captions = Object.fromEntries(targets.filter(({platform}) => state.channelCaptions[platform]?.trim())
    .map(({platform}) => [platform, state.channelCaptions[platform].trim()]));
  const dueAt = fields.mode === "customScheduled" ? scheduledDate()?.toISOString() || "" : "";
  const media = $("publicMediaUrl").value.trim();
  const aiGenerated = String($("aiGenerated").checked);
  const signature = JSON.stringify({targets, fields, captions, dueAt, media, aiGenerated, revision: media ? null : renderRevision});
  return {targets, fields, captions, dueAt, media, aiGenerated, signature};
}
function groupLabel(group, targets) {
  if (group === "twitter") return "X / Twitter";
  const names = [...new Set(targets.map(t => platformName(t.platform)))];
  return names.length ? names.join(" / ") : "Facebook / LinkedIn";
}
function readyVideo() {
  return preparedVideo && preparedRevision === renderRevision &&
    preparedVideo.size <= MAX_VIDEO_BYTES && BUFFER_VIDEO_TYPES.includes(preparedVideo.type.split(";")[0]);
}
const isStaticChannel = platform => platform === "facebook" || platform === "linkedin";
function staticTargets(chosen = selectedAccounts()) {
  return chosen.filter(t => isStaticChannel(t.platform) && t.accountId === $("staticDestination").value);
}
function syncStaticDestination() {
  const select = $("staticDestination"), previous=select.value;
  const chosen = selectedAccounts().filter(t=>isStaticChannel(t.platform));
  const connected = (socialConfig.platforms||[]).filter(p=>isStaticChannel(p.id)&&p.connected);
  const available = chosen.length ? connected.filter(p=>chosen.some(t=>t.accountId===p.accountId)) : connected;
  const signature = JSON.stringify(available.map(p=>[p.accountId,p.name,p.label]));
  if(select.dataset.options!==signature){
    select.replaceChildren();
    for(const p of available) select.add(new Option(p.name+" · "+p.label,p.accountId));
    if(!available.length) select.add(new Option("No connected Facebook or LinkedIn account",""));
    select.value=available.some(p=>p.accountId===previous)?previous:available[0]?.accountId||"";
    select.dataset.options=signature;
  }
  select.disabled=available.length<2||posting;
  const account=connected.find(p=>p.accountId===select.value);
  const active=account?.id||"facebook";
  $("fbFeedViewer").hidden=active!=="facebook";
  $("liFeedViewer").hidden=active!=="linkedin";
  const ready=socialConfig.configured&&!socialConfig.accountsError&&chosen.some(t=>t.accountId===select.value);
  $("staticBufferStatus").classList.toggle("ready",!!ready);
  $("staticBufferStatus").textContent=!socialConfig.configured||socialConfig.accountsError?"Buffer not connected. Check Social accounts.":ready?"Buffer · "+account.name+" · "+account.label+" · "+(account.paused?"Queue paused":"Connected"):account?"Buffer connected · select "+account.name+" in Social accounts to publish.":"Buffer connected · no Facebook or LinkedIn channel.";
  return account;
}
function staticSubmissionKey(snapshot){return "static:"+snapshot.targets[0]?.accountId;}
function staticSnapshot() {
  const snapshot = submissionSnapshot("other", staticTargets());
  const mediaKind = $("staticPostMode").value;
  const media = mediaKind === "image" ? $("staticImageUrl").value.trim() : "";
  const signature = JSON.stringify({targets:snapshot.targets,fields:snapshot.fields,captions:snapshot.captions,dueAt:snapshot.dueAt,
    mediaKind,media,revision:mediaKind==="image"&&!media?renderRevision:null,aiGenerated:snapshot.aiGenerated});
  return {...snapshot, mediaKind, media, signature};
}
function updateStaticPreviews() {
  const textOnly = $("staticPostMode").value === "text";
  const rawUrl = $("staticImageUrl").value.trim();
  let url = "", error = "";
  if (!textOnly && rawUrl) {
    try { url = publicMediaUrl(rawUrl, "image"); } catch (cause) { error = cause.message; }
  }
  $("staticImageControls").hidden = textOnly;
  $("staticImageUrl").setCustomValidity(error);
  $("staticImageUrl").setAttribute("aria-invalid", String(Boolean(error)));
  for (const [platform,prefix] of [["facebook","fb"],["linkedin","li"]]) {
    const account = socialConfig.platforms?.find(p=>p.id===platform && p.accountId===$("staticDestination").value)
      || socialConfig.platforms?.find(p=>p.id===platform);
    $(prefix+"PreviewName").textContent=account?.label || state.brand || "Pixel Shroom Studio";
    $(prefix+"PreviewCaption").textContent=captionFor(platform);
    $(prefix+"PreviewMedia").hidden=textOnly;
    const img=$(prefix+"PreviewImage"), src=url || (!rawUrl && stillRevision===renderRevision ? stillUrl : "");
    img.hidden=textOnly||!src;
    if (src && img.getAttribute("src")!==src) img.src=src;
    if (!src) img.removeAttribute("src");
  }
  return {url,error,textOnly};
}
function updateStaticReadiness(scheduleValid, counts) {
  syncStaticDestination();
  const snapshot=staticSnapshot(), {url,error,textOnly}=updateStaticPreviews();
  const previous=groupSubmissions.get(staticSubmissionKey(snapshot));
  const submitted=previous?.signature===snapshot.signature&&previous.completed;
  const tooLong=counts.some(c=>snapshot.targets.some(t=>t.platform===c.platform)&&c.limit&&c.count>c.limit);
  let reason="";
  if(posting||preparingVideo||capturingStill) reason="Preparing or submitting a post. Please wait.";
  else if(!socialConfig.configured||socialConfig.accountsError) reason="Connect Buffer and refresh accounts.";
  else if(!snapshot.targets.length) reason="Select Facebook or LinkedIn in Social accounts.";
  else if(tooLong) reason="Shorten the selected Facebook or LinkedIn caption.";
  else if(!scheduleValid) reason="Choose a valid publishing time.";
  else if(!snapshot.fields.title) reason="Enter a post title in Social post text.";
  else if(error) reason=error;
  else if(submitted) reason="Already submitted for this selection and post. Check Buffer submissions.";
  const verb={shareNow:"Publish post to",customScheduled:"Schedule post for"}[$("bufferMode").value]||"Queue post for";
  $("sendStaticPost").textContent=verb+" "+groupLabel("other",snapshot.targets);
  $("sendStaticPost").disabled=Boolean(reason);
  $("staticPostReady").textContent=reason||(textOnly?"Ready — text-only post, no media hosting needed.":url?"Ready — the public image URL will be attached.":socialConfig.uploadReady?"Ready — the still image will be captured and uploaded automatically.":"Image posts need Cloudinary or a public PNG/JPEG URL. Text-only posts need neither.");
  $("staticMediaNote").textContent=error||(socialConfig.uploadReady?"Cloudinary will host the still image automatically.":"Use a public PNG/JPEG URL, connect Cloudinary, or choose Text only.");
  $("captureStill").disabled=posting||preparingVideo||capturingStill;
  $("downloadStill").disabled=posting||preparingVideo||capturingStill||!stillImage||stillRevision!==renderRevision;
}
async function captureCurrentStill() {
  const revision=renderRevision;
  const blob=await renderStillImage();
  if(blob.size>MAX_IMAGE_BYTES) throw Error("The captured PNG exceeds 10 MB.");
  if(revision!==renderRevision) throw Error("Editor changed while capturing; capture again.");
  if(stillUrl) URL.revokeObjectURL(stillUrl);
  stillImage=blob; stillRevision=revision; stillUrl=URL.createObjectURL(blob);
  $("staticCaptureStatus").textContent="Still artwork captured · "+(blob.size/1024/1024).toFixed(2)+" MB · PNG";
  updateStaticPreviews();
  return blob;
}
async function refreshStillPreview() {
  if(posting||preparingVideo||capturingStill||$("staticPostMode").value==="text"||$("staticImageUrl").value.trim()) return;
  if(stillImage&&stillRevision===renderRevision) {updateStaticPreviews();return;}
  capturingStill=true;updatePublishSummary();
  try{await captureCurrentStill();}
  catch(error){$("staticCaptureStatus").textContent=error.message+" Use Capture current ad to try again.";}
  finally{capturingStill=false;updatePublishSummary();}
}
function updatePublishSummary() {
  updatePostPreview();
  const counts = updateCaptionCount();
  const notes = counts.map(({platform, count, limit}) =>
    platformName(platform) + (limit ? ": " + count.toLocaleString() + " / " + limit.toLocaleString() : "Buffer checks the server limit"));
  $("captionLimits").textContent = notes.length ? notes.join(" · ") : "Select channels to see their caption limits.";
  const tooLong = counts.filter(({count, limit}) => limit && count > limit);
  const twitterOver = tooLong.some(({platform}) => platform === "twitter");
  $("twitterLengthWarning").hidden = !twitterOver;
  const otherOver = tooLong.filter(({platform}) => platform !== "twitter");
  $("channelLengthWarning").hidden = !otherOver.length;
  $("channelLengthWarning").textContent = otherOver.length ? "Shorten the caption for " + otherOver.map(({platform}) => platformName(platform)).join(", ") + "." : "";
  const scheduleValid = updateSchedule(), chosen = selectedAccounts();
  const rawUrl = $("publicMediaUrl").value.trim();
  let url = "", urlError = "";
  if (rawUrl) {
    try { url = publicMediaUrl(rawUrl); } catch (error) { urlError = error.message; }
  }
  $("publicMediaUrl").setCustomValidity(urlError);
  $("publicMediaUrl").setAttribute("aria-invalid", String(Boolean(urlError)));
  const stale = preparedVideo && preparedRevision !== renderRevision && !rawUrl;
  $("publishSummary").textContent = chosen.length ? "Destinations: " + chosen.map(t =>
    socialConfig.platforms.find(p => p.accountId === t.accountId)?.label || t.platform).join(", ") : "Select connected Buffer channels above.";
  const verb = {shareNow: "Publish video to", customScheduled: "Schedule video for"}[$("bufferMode").value] || "Queue video for";
  for (const {key, button, status} of publishGroups) {
    const targets = groupTargets(key, chosen), snapshot = submissionSnapshot(key, targets);
    const over = key === "twitter" ? twitterOver : otherOver.length > 0;
    const previous = groupSubmissions.get(key);
    const submitted = previous?.signature === snapshot.signature && previous.completed;
    const missingBoard = targets.some(t => t.platform === "pinterest") && !$("pinterestBoard").value.trim();
    let reason = "";
    if (posting || preparingVideo || capturingStill) reason = "Preparing or submitting a post. Please wait.";
    else if (!socialConfig.configured || socialConfig.accountsError) reason = "Connect Buffer and refresh accounts.";
    else if (!targets.length) reason = key === "twitter" ? "Select a connected X / Twitter channel." : "Select Facebook, LinkedIn or another connected channel.";
    else if (over) reason = key === "twitter" ? "Shorten the X caption to 280 characters." : "Shorten the selected channel captions.";
    else if (!scheduleValid) reason = "Choose a valid publishing time.";
    else if (!snapshot.fields.title) reason = "Enter a post title in Social post text.";
    else if (missingBoard) reason = "Choose a Pinterest board for this group.";
    else if (urlError) reason = urlError;
    else if (submitted) reason = "Already submitted for this selection and post. Check Buffer submissions.";
    $(button).textContent = verb + " " + groupLabel(key, targets);
    $(button).disabled = !!reason;
    $(status).textContent = reason || (url ? "Ready to send the public video URL." : socialConfig.uploadReady
      ? readyVideo() ? "Ready to upload and publish." : "Ready — the video will render and upload automatically."
      : "Select to continue. A public MP4/MOV URL or Cloudinary is required.");
  }
  $("prepareVideo").disabled = posting || preparingVideo || capturingStill;
  if (stale) $("videoStatus").textContent = "Editor changed. The next publish will render the current animation.";
  else if (preparedVideo) $("videoStatus").textContent = "Video prepared · " + (preparedVideo.size / 1024 / 1024).toFixed(1) + " MB";
  $("mediaHostingStatus").textContent = urlError || (url ? "Buffer will use the public video URL you entered."
    : socialConfig.uploadReady ? "Cloudinary connected. The current animation renders and uploads automatically when you send."
    : "Configure Cloudinary on the Worker or enter a stable public MP4/MOV URL.");
  updateStaticReadiness(scheduleValid,counts);
}
function showAccounts(){const grid=$('socialAccounts'),checked=new Set(selectedAccounts().map(({accountId})=>accountId));grid.replaceChildren();for(const a of socialConfig.platforms||[]){const label=document.createElement('label');label.className='social-account';const input=document.createElement('input');input.type='checkbox';input.dataset.socialTarget=a.id;input.dataset.accountId=a.accountId;input.disabled=!a.connected;input.checked=a.connected&&checked.has(a.accountId);input.onchange=()=>{renderCaptionOverrides();updatePublishSummary()};const title=document.createElement('b'),detail=document.createElement('small'),text=document.createElement('span');title.textContent=a.name+' · '+a.label;detail.textContent=a.organization+' · '+(a.reauth?'Reconnect in Buffer':a.locked?'Locked in Buffer':!a.connected?'Video posting not enabled':a.paused?'Queue paused':'Connected');text.append(title,detail);label.append(input,text);grid.append(label)}if(!socialConfig.platforms?.length){const p=document.createElement('p');p.className='muted';p.textContent=socialConfig.configured?'No channels found. Connect social accounts in Buffer, then refresh.':'Connect your key to load your Buffer channels.';grid.append(p)}renderCaptionOverrides();updatePublishSummary()}
function syncConnectionSections() {
  const managed = socialConfig.bufferSource === "worker";
  const storageReady = socialConfig.secureStorage !== false;
  const connected = socialConfig.configured && !socialConfig.accountsError;
  $("bufferSetup").open = !connected;
  $("mediaSetup").open = !socialConfig.uploadReady;
  $("bufferSetupSummary").textContent = connected
    ? managed ? "Buffer connected · Worker-managed key" : "Buffer connected · update API key"
    : managed ? "Buffer connection · check Worker key" : "Connect your personal Buffer API key";
  $("mediaSetupSummary").textContent = socialConfig.uploadReady ? "Cloudinary media hosting connected" : "Cloudinary media hosting setup";
  const missing=socialConfig.cloudinaryMissing||[], invalid=socialConfig.cloudinaryInvalid||[];
  $("cloudinaryDiagnostics").textContent=socialConfig.uploadReady?"Hosting configuration present.":(missing.length?"Missing Worker settings: "+missing.join(", ")+". ":"")+(invalid.length?"Check format of: "+invalid.join(", ")+".":"");
  $("bufferConnectForm").hidden = managed || !storageReady;
  $("bufferManagedNotice").hidden = !managed;
  $("bufferManagedNotice").textContent = managed ? "This connection uses the Worker secret BUFFER_API_KEY. Update it in Cloudflare if needed, then refresh accounts." : "";
  $("bufferStorageNotice").hidden = managed || storageReady;
  $("bufferStorageNotice").textContent = storageReady ? "" : "Configure BUFFER_API_KEY on the Worker, or set BUFFER_CREDENTIAL_ENCRYPTION_KEY to a 64-character hexadecimal encryption key and enter your personal Buffer API key below.";
  $("connectionStatus").textContent = connected && !managed ? "Your API key is saved securely. No need to enter it again." : "";
}
async function refreshSocialAccounts() {
  try {
    socialConfig = await socialApi("config");
    syncConnectionSections();
    $("serviceNotice").textContent = socialConfig.accountsError || (socialConfig.configured
      ? "Buffer connected. Select channels below."
      : "Connect your personal Buffer API key to load your channels.");
    $("serviceNotice").classList.toggle("ready", socialConfig.configured && !socialConfig.accountsError);
  } catch (error) {
    socialConfig = {configured: false, platforms: []};
    $("serviceNotice").textContent = "Could not check saved connections. " + error.message;
    $("serviceNotice").classList.remove("ready");
    syncConnectionSections();
  }
  showAccounts();
}

function choosePage() {
  const publish = location.hash === "#publish";
  $("editorPage").hidden = publish;
  $("publishPage").hidden = !publish;
  for (const [id, active] of [["editorTab", !publish], ["publishTab", publish]]) {
    $(id).classList.toggle("selected", active);
    $(id).setAttribute("aria-current", active ? "page" : "false");
  }
  if (publish) {
    syncSocialCopy();
    refreshSocialAccounts();
    refreshHistory();
    updatePublishSummary();
    void refreshStillPreview();
  } else requestPreview();
}

export function useGeneratedVideo(blob) {
  if(posting||preparingVideo||capturingStill)throw Error("Wait for the current render or publication to finish.");
  if(!blob||blob.size>MAX_VIDEO_BYTES||!BUFFER_VIDEO_TYPES.includes(blob.type.split(";")[0]))throw Error("Generated video must be MP4/MOV under 16 MB. Download it and resize if needed.");
  setVideo(blob);location.hash="publish";choosePage();
}
function setVideo(blob) {
  preparedVideo = blob;
  preparedRevision = renderRevision;
  $("publicMediaUrl").value = "";
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(blob);
  $("publishPreview").src = videoUrl;
  updatePublishSummary();
}

async function directUpload(video, kind = "video") {
  if (hostedVideos.has(video)) return hostedVideos.get(video);
  const signed = await socialApi("upload-ticket"+(kind==="image"?"?kind=image":""), {method: "POST"});
  const form = new FormData();
  for (const [name, value] of Object.entries(signed.fields)) form.set(name, value);
  form.set("file", video, kind==="image"?"pixel-shroom-ad.png":"pixel-shroom-ad.mp4");
  const response = await fetch(signed.endpoint, {method: "POST", body: form, redirect: "error",
    signal: AbortSignal.timeout(120000)});
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.secure_url || result.public_id !== signed.fields.public_id) {
    throw Error("Cloudinary could not upload this "+kind+" (HTTP " + response.status + ").");
  }
  const url = publicMediaUrl(result.secure_url,kind);
  hostedVideos.set(video, url);
  return url;
}

function results(data, statusId="publishStatus"){$(statusId).replaceChildren();const p=document.createElement('p');p.textContent=data.message||'Status: '+data.status;$(statusId).append(p);for(const r of data.results||[]){const row=document.createElement('p');row.textContent=(SOCIAL_CATALOG.find(p=>p[0]===r.platform)?.[1]||r.platform)+': '+({sent:'Published',scheduled:'Scheduled in Buffer',sending:'Publishing',needs_approval:'Awaiting approval',draft:'Draft in Buffer',error:'Failed',unconfirmed:'Unconfirmed — check Buffer'}[r.status]||r.status)+(r.message?' · '+r.message:'');$(statusId).append(row)}}
async function refreshHistory() {
  try {
    ({submissions} = await socialApi("history"));
    renderHistory();
  } catch (error) {
    $("publishHistory").textContent = error.message;
  }
}

function renderHistory() {
  const el = $("publishHistory");
  el.replaceChildren();
  for (const item of submissions) {
    const row = document.createElement("div");
    row.className = "submission-row";
    const label = document.createElement("span");
    label.textContent = item.title + " · " + (item.mediaKind==="image"?"Image post":item.mediaKind==="text"?"Text post":"Video") + " · " + item.status + (item.dueAt ? " · " + new Date(item.dueAt).toLocaleString() : "");
    const check = document.createElement("button");
    check.textContent = "Check status";
    check.onclick = async () => {
      try {
        const data=await socialApi("status?id=" + encodeURIComponent(item.id));
        results(data);
        if(item.mediaKind==="image"||item.mediaKind==="text") results(data,"staticPostStatus");
        await refreshHistory();
      } catch (error) { $("publishStatus").textContent = error.message; }
    };
    const remove = document.createElement("button");
    remove.textContent = "Delete";
    remove.className = "delete-submission";
    remove.title = "Remove from account history. The Buffer post is unchanged.";
    remove.onclick = async () => {
      remove.disabled = true;
      try {
        await socialApi("history?id=" + encodeURIComponent(item.id), {method: "POST"});
        await refreshHistory();
      } catch (error) {
        remove.disabled = false;
        $("publishStatus").textContent = error.message;
      }
    };
    row.append(label, check, remove);
    el.append(row);
  }
  if (!submissions.length) el.textContent = "No Buffer submissions yet.";
}

async function prepareCurrentVideo() {
  const announce = message => { $("videoStatus").textContent = message; };
  setVideo(await renderAnimation(progress => announce("Rendering " + Math.round(progress * 100) + "%"),
    {publish: true, announce}));
  if (!readyVideo()) throw Error("The rendered video is not an accepted MP4/MOV under 16 MB.");
  return preparedVideo;
}
async function sendPost(group) {
  updatePublishSummary();
  const button = publishGroups.find(item => item.key === group)?.button;
  if (!button || posting || preparingVideo || capturingStill || $(button).disabled) return;
  const snapshot = submissionSnapshot(group);
  if (!snapshot.media && !socialConfig.uploadReady) {
    $("publishStatus").textContent = "Buffer is connected, but video hosting is not configured. Enter a public HTTPS MP4/MOV URL or configure Cloudinary before publishing. No post was sent.";
    $("mediaSetup").open = true;
    $("publicMediaUrl").focus();
    return;
  }
  let submission = groupSubmissions.get(group);
  if (submission?.signature !== snapshot.signature) {
    submission = {signature: snapshot.signature, id: crypto.randomUUID(), completed: false};
    groupSubmissions.set(group, submission);
  }
  posting = true;
  updatePublishSummary();
  const form = new FormData();
  let media = snapshot.media, attemptedSubmission = false;
  try {
    for (const [field, value] of Object.entries(snapshot.fields)) form.set(field, value);
    form.set("targets", JSON.stringify(snapshot.targets));
    form.set("captions", JSON.stringify(snapshot.captions));
    if (snapshot.dueAt) form.set("dueAt", snapshot.dueAt);
    form.set("aiGenerated", snapshot.aiGenerated);
    if (!media) {
      $("publishStatus").textContent = readyVideo() ? "Preparing upload…" : "Rendering the current ad for " + groupLabel(group, snapshot.targets) + "…";
      const video = readyVideo() ? preparedVideo : await prepareCurrentVideo();
      $("publishStatus").textContent = "Uploading the video to Cloudinary…";
      try { media = await directUpload(video); } catch (error) {
        if (socialConfig.uploadMode !== "legacy") throw error;
        form.set("video", video, "pixel-shroom-ad.mp4");
      }
    }
    if (media) form.set("mediaUrl", media);
    $("publishStatus").textContent = "Sending to " + groupLabel(group, snapshot.targets) + " via Buffer…";
    attemptedSubmission = true;
    const data = await socialApi("publish", {method: "POST", headers: {"Idempotency-Key": submission.id}, body: form});
    submission.completed = true;
    results(data);
    // Keep the rendered video/public URL for the other destination group.
  } catch (error) {
    $("publishStatus").textContent = error.message + (attemptedSubmission ? " Check Buffer before creating another submission." : " No post was sent to Buffer.");
  } finally {
    posting = false;
    await refreshHistory();
    updatePublishSummary();
  }
}

async function sendStaticPost() {
  updatePublishSummary();
  if(posting||preparingVideo||capturingStill||$("sendStaticPost").disabled)return;
  const snapshot=staticSnapshot();
  if(snapshot.mediaKind==="image"&&!snapshot.media&&!socialConfig.uploadReady){
    $("staticPostStatus").textContent="Image posts need a public PNG/JPEG URL or Cloudinary. Choose Text only to publish without hosting. No post was sent.";
    $("staticImageUrl").focus();return;
  }
  const key=staticSubmissionKey(snapshot);
  let submission=groupSubmissions.get(key);
  if(submission?.signature!==snapshot.signature){
    submission={signature:snapshot.signature,id:crypto.randomUUID(),completed:false};
    groupSubmissions.set(key,submission);
  }
  posting=true;updatePublishSummary();
  const form=new FormData();
  let media=snapshot.media,attempted=false;
  try{
    for(const [field,value] of Object.entries(snapshot.fields))form.set(field,value);
    form.set("mediaKind",snapshot.mediaKind);
    form.set("targets",JSON.stringify(snapshot.targets));
    form.set("captions",JSON.stringify(snapshot.captions));
    form.set("aiGenerated",snapshot.aiGenerated);
    if(snapshot.dueAt)form.set("dueAt",snapshot.dueAt);
    if(snapshot.mediaKind==="image"&&!media){
      $("staticPostStatus").textContent="Capturing the still image…";
      const image=stillImage&&stillRevision===renderRevision?stillImage:await captureCurrentStill();
      $("staticPostStatus").textContent="Uploading the still image…";
      try{media=await directUpload(image,"image");}
      catch(error){if(socialConfig.uploadMode!=="legacy")throw error;form.set("image",image,"pixel-shroom-ad.png");}
    }
    if(media)form.set("mediaUrl",media);
    $("staticPostStatus").textContent="Sending normal feed post to Buffer…";
    attempted=true;
    const data=await socialApi("publish",{method:"POST",headers:{"Idempotency-Key":submission.id},body:form});
    submission.completed=true;results(data,"staticPostStatus");results(data);
  }catch(error){$("staticPostStatus").textContent=error.message+(attempted?" Check Buffer before trying again.":" No post was sent.");}
  finally{posting=false;await refreshHistory();updatePublishSummary();}
}
export function initSocialPublishing() {
  $("editorTab").onclick = () => { location.hash = "editor"; };
  $("publishTab").onclick = () => { location.hash = "publish"; };
  window.addEventListener("hashchange", choosePage);
  $("refreshAccounts").onclick = refreshSocialAccounts;
  $("jumpStaticPosts").onclick = () => $("static-post-title").scrollIntoView({behavior:"smooth",block:"start"});
  $("editPostDetails").onclick = () => {
    location.hash = "editor";
    choosePage();
    $("socialCopySettings").open = true;
    $("publishCaption").focus();
  };
  $("bufferConnectForm").onsubmit = async event => {
    event.preventDefault();
    const key = $("bufferApiKey").value.trim();
    $("bufferApiKey").value = "";
    $("saveBufferKey").disabled = true;
    $("connectionStatus").textContent = "Validating your key with Buffer…";
    try {
      await socialApi("connect", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({bufferKey: key})});
      await refreshSocialAccounts();
    } catch (error) { $("connectionStatus").textContent = error.message; }
    finally { $("saveBufferKey").disabled = false; }
  };
  $("prepareVideo").onclick = async () => {
    if (posting || preparingVideo || capturingStill) return;
    preparingVideo = true;
    updatePublishSummary();
    try { await prepareCurrentVideo(); }
    catch (error) { $("videoStatus").textContent = error.message; }
    finally { preparingVideo = false; updatePublishSummary(); }
  };
  for (const id of ["publishTitle", "publishCaption", "youtubePrivacy", "pinterestBoard", "aiGenerated", "bufferMode", "scheduledAt", "publicMediaUrl"]) {
    $(id).oninput = () => {
      const key = {publishTitle: "socialTitle", publishCaption: "socialCaption", youtubePrivacy: "youtubePrivacy",
        pinterestBoard: "pinterestBoard", aiGenerated: "aiGenerated"}[id];
      if (key) state[key] = id === "aiGenerated" ? $(id).checked : $(id).value;
      updatePublishSummary();
    };
  }
  $("captureStill").onclick=async()=>{
    if(posting||preparingVideo||capturingStill)return;
    $("staticImageUrl").value="";
    capturingStill=true;updatePublishSummary();
    try{await captureCurrentStill();}catch(error){$("staticCaptureStatus").textContent=error.message;}
    finally{capturingStill=false;updatePublishSummary();}
  };
  $("downloadStill").onclick=()=>{
    if(!stillUrl||stillRevision!==renderRevision)return;
    const a=document.createElement("a");a.href=stillUrl;a.download="pixel-shroom-ad.png";a.click();
  };
  $("staticDestination").onchange=()=>updatePublishSummary();
  $("staticPostMode").oninput=()=>{updatePublishSummary();void refreshStillPreview();};
  $("staticImageUrl").oninput=()=>{updatePublishSummary();if(!$("staticImageUrl").value.trim())void refreshStillPreview();};
  $("sendStaticPost").onclick=sendStaticPost;
  $("sendSocialX").onclick = () => sendPost("twitter");
  $("sendSocial").onclick = () => sendPost("other");
  syncSocialCopy();
  choosePage();
}

