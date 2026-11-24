import {ArrayBufferTarget, Muxer} from "mp4-muxer";
import {MAX_VIDEO_BYTES} from "../ad-studio-rules.mjs";

const frameRate = 30;
const mp4Types = ["video/mp4;codecs=avc1.420028", "video/mp4"];
const webmTypes = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
const recorderType = (canvas, publish) => canvas.captureStream && globalThis.MediaRecorder
  ? [...mp4Types, ...(publish ? [] : webmTypes)].find(type => MediaRecorder.isTypeSupported(type))
  : null;

async function chooseVideoEncoder(canvas, duration, publish) {
  // Leave room for muxing overhead and moderate rate-control overshoot.
  const bitrate = Math.min(8_000_000, Math.floor(MAX_VIDEO_BYTES * .8 * 8 / duration));
  if (globalThis.VideoEncoder && globalThis.VideoFrame) {
    for (const codec of ["avc1.420028", "avc1.4d0028"]) {
      try {
        const options = {codec, width: canvas.width, height: canvas.height, framerate: frameRate,
          bitrate, bitrateMode: "constant", avc: {format: "avc"}, latencyMode: "realtime"};
        const supported = await VideoEncoder.isConfigSupported(options);
        if (supported.supported) return {options: supported.config, bitrate};
      } catch { /* Try the next encoder or use the recorder fallback. */ }
    }
  }
  const type = recorderType(canvas, publish);
  if (!type) throw Error(publish
    ? "This browser can’t encode MP4 for Buffer. Use a browser with MP4 export or provide a public MP4/MOV URL."
    : "This browser has no supported video encoder.");
  return {type, bitrate};
}

async function encodeFrames(canvas, duration, options, paint, progress) {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({target, video: {codec: "avc", width: canvas.width, height: canvas.height},
    fastStart: "in-memory"});
  let failure;
  const encoder = new VideoEncoder({
    output(chunk, metadata) {
      try { muxer.addVideoChunk(chunk, metadata); } catch (error) { failure = error; }
    },
    error(error) { failure = error; }
  });
  try {
    encoder.configure(options);
    const count = Math.ceil(duration * frameRate);
    for (let index = 0; index < count; index++) {
      if (failure) throw failure;
      const start = Math.round(index * 1_000_000 / frameRate);
      const end = Math.min(Math.round(duration * 1_000_000), Math.round((index + 1) * 1_000_000 / frameRate));
      paint(index / frameRate);
      const frame = new VideoFrame(canvas, {timestamp: start, duration: end - start});
      try { encoder.encode(frame, {keyFrame: index % (frameRate * 2) === 0}); } finally { frame.close(); }
      if (encoder.encodeQueueSize >= 6) await encoder.flush();
      if (index % 6 === 0) {
        progress((index + 1) / count);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
    return new Blob([target.buffer], {type: "video/mp4"});
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}

function recordPreview(canvas, duration, {type, bitrate}, paint, progress) {
  if (document.hidden) throw Error("Keep this tab visible during browser recording.");
  return new Promise((resolve, reject) => {
    const stream = canvas.captureStream(frameRate);
    const chunks = [];
    let recorder, timer, failure;
    function cleanup() {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const track of stream.getTracks()) track.stop();
    }
    function onVisibility() {
      if (!document.hidden || recorder.state === "inactive") return;
      failure = Error("Recording stopped because the browser tab was hidden. Keep it visible and try again.");
      recorder.stop();
    }
    try {
      recorder = new MediaRecorder(stream, {mimeType: type, videoBitsPerSecond: bitrate});
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { cleanup(); reject(Error("Video recording failed.")); };
      recorder.onstop = () => {
        cleanup();
        const blob = new Blob(chunks, {type: type.split(";")[0]});
        if (failure || !blob.size) reject(failure || Error("The recorder produced an empty video."));
        else resolve(blob);
      };
      document.addEventListener("visibilitychange", onVisibility);
      paint(0);
      recorder.start();
      const started = performance.now();
      function step() {
        if (recorder.state === "inactive") return;
        try {
          const elapsed = (performance.now() - started) / 1000;
          if (elapsed >= duration) { recorder.stop(); return; }
          paint(elapsed);
          progress(elapsed / duration);
          timer = setTimeout(step, 1000 / frameRate);
        } catch (error) {
          failure = error;
          recorder.stop();
        }
      }
      timer = setTimeout(step, 1000 / frameRate);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export async function exportAdVideo(canvas, duration, {publish, paint, progress, announce}) {
  const encoder = await chooseVideoEncoder(canvas, duration, publish);
  let blob;
  if (encoder.options) {
    announce("Encoding MP4 frames…");
    try { blob = await encodeFrames(canvas, duration, encoder.options, paint, progress); }
    catch (error) {
      const type = recorderType(canvas, publish);
      if (!type) throw Error("The MP4 encoder could not finish. Try a different browser.", {cause: error});
      announce("Recording in real time. Keep this tab visible.");
      blob = await recordPreview(canvas, duration, {...encoder, type}, paint, progress);
    }
  } else {
    announce("Recording in real time. Keep this tab visible.");
    blob = await recordPreview(canvas, duration, encoder, paint, progress);
  }
  if (publish && blob.size > MAX_VIDEO_BYTES) {
    throw Error("Video exceeds 16 MB. Shorten the ad or use a public MP4/MOV URL.");
  }
  return blob;
}
