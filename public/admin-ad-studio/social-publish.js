import {$, state, renderRevision, requestPreview, renderAnimation} from "./app.js";
import {BUFFER_VIDEO_TYPES, MAX_VIDEO_BYTES, captionLength, publicMediaUrl} from "../ad-studio-rules.mjs";

const SOCIAL_CATALOG=[['instagram','Instagram'],['facebook','Facebook'],['tiktok','TikTok'],['youtube','YouTube'],['linkedin','LinkedIn'],['twitter','X'],['threads','Threads'],['pinterest','Pinterest'],['bluesky','Bluesky'],['mastodon','Mastodon'],['googlebusiness','Google Business']];
let socialConfig = {configured: false, platforms: []};
const hostedVideos = new WeakMap();
let preparedVideo = null, preparedRevision = null, videoUrl = null, posting = false, submissionId = null, submissions = [];
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
      submissionId = null;
      updatePublishSummary();
    };
    label.append(input);
    container.append(label);
  }
}
export function syncSocialCopy(){$('publishTitle').value=state.socialTitle||String(state.headline).slice(0,100);$('publishCaption').value=state.socialCaption||state.headline+'\n'+state.website;$('youtubePrivacy').value=state.youtubePrivacy||'public';$('pinterestBoard').value=state.pinterestBoard||'';$('aiGenerated').checked=state.aiGenerated!==false;updatePostPreview()}
function updatePostPreview(){$('postTitlePreview').textContent=$('publishTitle').value.trim()||state.headline;$('postCaptionPreview').textContent=$('publishCaption').value.trim()||state.headline+'\n'+state.website;$('postSettingsPreview').textContent='YouTube: '+$('youtubePrivacy').value+' · '+($('aiGenerated').checked?'AI imagery disclosed':'AI imagery disclosure off')+($('pinterestBoard').value?' · Pinterest board: '+$('pinterestBoard').value:'')}
function updatePublishSummary() {
  updatePostPreview();
  const counts = updateCaptionCount();
  const notes = counts.map(({platform, count, limit}) =>
    platformName(platform) + (limit ? ": " + count.toLocaleString() + " / " + limit.toLocaleString() : ": Buffer checks the server limit"));
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
  const ready = preparedVideo && preparedVideo.size <= MAX_VIDEO_BYTES && socialConfig.uploadReady &&
    BUFFER_VIDEO_TYPES.includes(preparedVideo.type.split(";")[0]);
  $("publishSummary").textContent = chosen.length ? "Destinations: " + chosen.map(t =>
    socialConfig.platforms.find(p => p.accountId === t.accountId)?.label || t.platform).join(", ") : "Select connected Buffer channels above.";
  $("sendSocial").textContent = {shareNow: "Publish now via Buffer", customScheduled: "Schedule via Buffer"}[$("bufferMode").value] || "Add to Buffer queue";
  $("sendSocial").disabled = !!(tooLong.length || posting || !scheduleValid || !socialConfig.configured ||
    !chosen.length || urlError || !(url || ready) || stale);
  if (stale) $("videoStatus").textContent = "Editor changed. Render the current animation again.";
  else if (preparedVideo) $("videoStatus").textContent = "Video prepared · MP4 · " + (preparedVideo.size / 1024 / 1024).toFixed(1) + " MB";
  $("mediaHostingStatus").textContent = urlError || (url ? "Buffer will use the public video URL you entered."
    : socialConfig.uploadReady ? "Cloudinary connected. Your video uploads directly when you send."
    : "Configure Cloudinary on the Worker or enter a stable public MP4/MOV URL.");
}
function showAccounts(){const grid=$('socialAccounts'),checked=new Set(selectedAccounts().map(({accountId})=>accountId));grid.replaceChildren();for(const a of socialConfig.platforms||[]){const label=document.createElement('label');label.className='social-account';const input=document.createElement('input');input.type='checkbox';input.dataset.socialTarget=a.id;input.dataset.accountId=a.accountId;input.disabled=!a.connected;input.checked=a.connected&&checked.has(a.accountId);input.onchange=()=>{submissionId=null;renderCaptionOverrides();updatePublishSummary()};const title=document.createElement('b'),detail=document.createElement('small'),text=document.createElement('span');title.textContent=a.name+' · '+a.label;detail.textContent=a.organization+' · '+(a.reauth?'Reconnect in Buffer':a.locked?'Locked in Buffer':!a.connected?'Video posting not enabled':a.paused?'Queue paused':'Connected');text.append(title,detail);label.append(input,text);grid.append(label)}if(!socialConfig.platforms?.length){const p=document.createElement('p');p.className='muted';p.textContent=socialConfig.configured?'No channels found. Connect social accounts in Buffer, then refresh.':'Connect your key to load your Buffer channels.';grid.append(p)}renderCaptionOverrides();updatePublishSummary()}
function syncConnectionSections(){
$('bufferSetup').open=!socialConfig.configured||!!socialConfig.bufferNeedsUpdate;
$('mediaSetup').open=!socialConfig.uploadReady;
$('bufferSetupSummary').textContent=socialConfig.configured?(socialConfig.bufferNeedsUpdate?'Buffer connection · update required':'Buffer connected · update API key'):'Connect your personal Buffer API key';
$('mediaSetupSummary').textContent=socialConfig.uploadReady?'Cloudinary video hosting connected':'Cloudinary video hosting setup';
$('connectSocial').textContent=socialConfig.configured?'Update Buffer key':'Connect Buffer';
$('connectionStatus').textContent=socialConfig.configured?'Your API key is saved securely. No need to enter it again.':'';
$('mediaConnectionStatus').textContent=socialConfig.uploadReady?'Credentials remain on the Worker.':'';
}
async function refreshSocialAccounts(){try{socialConfig=await socialApi('config');syncConnectionSections();$('serviceNotice').textContent=socialConfig.accountsError?(socialConfig.bufferNeedsUpdate?socialConfig.accountsError:'Your Buffer key is saved. Channels could not be refreshed: '+socialConfig.accountsError):socialConfig.configured?'Buffer connected. Your API key is saved; select channels below.':'Connect the personal API key you created to load your Buffer channels.';$('serviceNotice').classList.toggle('ready',socialConfig.configured&&!socialConfig.accountsError)}catch(error){$('serviceNotice').textContent='Could not check saved connections. '+error.message}showAccounts()}

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
  } else requestPreview();
}

function setVideo(blob) {
  preparedVideo = blob;
  preparedRevision = renderRevision;
  submissionId = null;
  $("publicMediaUrl").value = "";
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(blob);
  $("publishPreview").src = videoUrl;
  updatePublishSummary();
}

async function directUpload(video) {
  if (hostedVideos.has(video)) return hostedVideos.get(video);
  const signed = await socialApi("upload-ticket", {method: "POST"});
  const form = new FormData();
  for (const [name, value] of Object.entries(signed.fields)) form.set(name, value);
  form.set("file", video, "pixel-shroom-ad.mp4");
  const response = await fetch(signed.endpoint, {method: "POST", body: form, redirect: "error",
    signal: AbortSignal.timeout(120000)});
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.secure_url || result.public_id !== signed.fields.public_id) {
    throw Error("Cloudinary could not upload this video (HTTP " + response.status + ").");
  }
  const url = publicMediaUrl(result.secure_url);
  hostedVideos.set(video, url);
  return url;
}

function results(data){$('publishStatus').replaceChildren();const p=document.createElement('p');p.textContent=data.message||'Status: '+data.status;$('publishStatus').append(p);for(const r of data.results||[]){const row=document.createElement('p');row.textContent=(SOCIAL_CATALOG.find(p=>p[0]===r.platform)?.[1]||r.platform)+': '+({sent:'Published',scheduled:'Scheduled in Buffer',sending:'Publishing',needs_approval:'Awaiting approval',draft:'Draft in Buffer',error:'Failed',unconfirmed:'Unconfirmed — check Buffer'}[r.status]||r.status)+(r.message?' · '+r.message:'');$('publishStatus').append(row)}}
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
    label.textContent = item.title + " · " + item.status + (item.dueAt ? " · " + new Date(item.dueAt).toLocaleString() : "");
    const check = document.createElement("button");
    check.textContent = "Check status";
    check.onclick = async () => {
      try {
        results(await socialApi("status?id=" + encodeURIComponent(item.id)));
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

async function sendPost() {
  updatePublishSummary();
  if (posting || $("sendSocial").disabled) return;
  posting = true;
  submissionId ||= crypto.randomUUID();
  const id = submissionId, targets = selectedAccounts(), form = new FormData(), video = preparedVideo;
  let media = $("publicMediaUrl").value.trim();
  let attemptedSubmission = false;
  try {
    for (const [field, input] of Object.entries({title: "publishTitle", caption: "publishCaption", mode: "bufferMode",
      youtubePrivacy: "youtubePrivacy", pinterestBoard: "pinterestBoard"})) form.set(field, $(input).value.trim());
    form.set("targets", JSON.stringify(targets));
    form.set("captions", JSON.stringify(Object.fromEntries(targets
      .filter(({platform}) => state.channelCaptions[platform]?.trim())
      .map(({platform}) => [platform, state.channelCaptions[platform].trim()]))));
    if (form.get("mode") === "customScheduled") form.set("dueAt", scheduledDate().toISOString());
    form.set("aiGenerated", String($("aiGenerated").checked));
    updatePublishSummary();
    if (!media) {
      $("publishStatus").textContent = "Uploading the video to Cloudinary…";
      try { media = await directUpload(video); } catch (error) {
        if (socialConfig.uploadMode !== "legacy") throw error;
        form.set("video", video, "pixel-shroom-ad.mp4");
      }
    }
    if (media) form.set("mediaUrl", media);
    $("publishStatus").textContent = "Sending to Buffer…";
    attemptedSubmission = true;
    results(await socialApi("publish", {method: "POST", headers: {"Idempotency-Key": id}, body: form}));
    preparedVideo = null;
    $("publicMediaUrl").value = "";
  } catch (error) {
    $("publishStatus").textContent = error.message + (attemptedSubmission ? " Check Buffer before creating another submission." : " No post was sent to Buffer.");
  } finally {
    posting = false;
    await refreshHistory();
    updatePublishSummary();
  }
}

export function initSocialPublishing() {
  $("editorTab").onclick = () => { location.hash = "editor"; };
  $("publishTab").onclick = () => { location.hash = "publish"; };
  window.addEventListener("hashchange", choosePage);
  $("refreshAccounts").onclick = refreshSocialAccounts;
  $("editPostDetails").onclick = () => {
    location.hash = "editor";
    choosePage();
    $("socialCopySettings").open = true;
    $("publishCaption").focus();
  };
  $("connectSocial").onclick = () => { $("bufferSetup").open = true; $("bufferApiKey").focus(); };
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
    $("prepareVideo").disabled = true;
    try {
      const announce = message => { $("videoStatus").textContent = message; };
      setVideo(await renderAnimation(progress => announce("Rendering " + Math.round(progress * 100) + "%"),
        {publish: true, announce}));
    } catch (error) { $("videoStatus").textContent = error.message; }
    finally { $("prepareVideo").disabled = false; }
  };
  for (const id of ["publishTitle", "publishCaption", "youtubePrivacy", "pinterestBoard", "aiGenerated", "bufferMode", "scheduledAt", "publicMediaUrl"]) {
    $(id).oninput = () => {
      const key = {publishTitle: "socialTitle", publishCaption: "socialCaption", youtubePrivacy: "youtubePrivacy",
        pinterestBoard: "pinterestBoard", aiGenerated: "aiGenerated"}[id];
      if (key) state[key] = id === "aiGenerated" ? $(id).checked : $(id).value;
      submissionId = null;
      updatePublishSummary();
    };
  }
  $("sendSocial").onclick = sendPost;
  syncSocialCopy();
  choosePage();
}

