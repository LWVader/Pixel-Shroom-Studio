// Presentation only: tier, ownership and payment outcomes always come from the backend.
const PALETTES = {
  Standard: ["#f4c07b", "#fff4c4"],
  Silver: ["#a5cbef", "#f4f9ff"],
  Gold: ["#eac15a", "#fff4c4"],
  Emerald: ["#28d996", "#d3ffe5"],
  Sapphire: ["#5798ff", "#b8eeff"],
  Prismatic: ["#b991ff", "#72efff"],
};
const DURATION = 4400;
export function mountFoilReveal(panel, image, options = {}) {
  const duration = options.duration || DURATION;
  const colors = PALETTES[panel.dataset.tier] || PALETTES.Standard;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const scene = document.createElement("div");
  scene.className = "foil-scene";
  scene.dataset.animation = "preparing";
  image.style.visibility = "hidden";
  scene.style.setProperty("--foil-light", colors[0]);
  scene.style.setProperty("--foil-spark", colors[1]);
  const rotor = document.createElement("div");
  rotor.className = "foil-rotor";
  const back = document.createElement("div");
  back.className = "foil-back";
  back.setAttribute("aria-hidden", "true");
  back.innerHTML =
    "<span>PIXEL SHROOM<br>STUDIO</span><span class='foil-back-emblem'>✦</span><span>LWVADER<br>VERIFIABLE ART</span>";
  const seal = back.cloneNode(true);
  seal.className = "foil-back foil-seal";
  const shine = document.createElement("div");
  shine.className = "foil-shine";
  shine.setAttribute("aria-hidden", "true");
  const canvas = document.createElement("canvas");
  canvas.className = "foil-lightning";
  canvas.setAttribute("aria-hidden", "true");
  image.before(scene);
  rotor.append(image, seal, shine, back);
  scene.append(rotor, canvas);
  const controls = document.createElement("div");
  controls.className = "foil-reveal-controls";
  const replay = document.createElement("button");
  replay.type = "button";
  replay.className = "buy-button";
  replay.textContent = "Replay reveal";
  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "buy-button";
  skip.textContent = "Skip animation";
  skip.hidden = true;
  const status = document.createElement("span");
  status.className = "foil-animation-status";
  status.setAttribute("role", "status");
  controls.append(replay, skip, status);
  scene.after(controls);
  if (options.concealed) replay.hidden = true;
  const context = canvas.getContext("2d");
  let frame = 0,
    started = 0,
    running = false,
    disposed = false,
    generation = 0;
  let width = 1,
    height = 1,
    nextStrike = 0,
    bolts = [],
    particles = [];
  function resize() {
    const box = scene.getBoundingClientRect();
    width = Math.max(1, box.width);
    height = Math.max(1, box.height);
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(scene);
  function finish(announce = true) {
    cancelAnimationFrame(frame);
    running = false;
    scene.classList.remove("is-spinning");
    scene.dataset.animation = "complete";
    image.style.visibility = options.concealed ? "hidden" : "visible";
    seal.hidden = !options.concealed;
    rotor.style.transform = "";
    scene.style.setProperty("--impact", "0");
    context?.clearRect(0, 0, width, height);
    skip.hidden = true;
    replay.disabled = false;
    if (announce) options.onComplete?.();
    if (announce)
      status.textContent = options.concealed
        ? "Waiting for secure checkout…"
        : motion.matches
          ? "Motion effects off. Edition ready."
          : "Edition ready.";
  }
  function strike(elapsed, progress) {
    const side = nextStrike % 2 ? 1 : -1;
    const end = {
      x: width / 2 + side * width * 0.2 * Math.abs(Math.cos(progress * Math.PI * 6)),
      y: height * (0.35 + Math.random() * 0.22),
    };
    const start = { x: side < 0 ? width * 0.05 : width * 0.95, y: height * 0.02 };
    const points = [start];
    for (let i = 1; i < 12; i++) {
      const t = i / 12;
      points.push({
        x: start.x + (end.x - start.x) * t + (Math.random() - 0.5) * width * 0.11,
        y: start.y + (end.y - start.y) * t,
      });
    }
    points.push(end);
    const fork = points[6];
    bolts.push({
      points,
      branch: [
        fork,
        { x: fork.x + side * width * 0.08, y: fork.y + height * 0.07 },
        { x: fork.x + side * width * 0.15, y: fork.y + height * 0.1 },
      ],
      born: elapsed,
    });
    for (let i = 0; i < 18; i++)
      particles.push({
        x: end.x,
        y: end.y,
        vx: (Math.random() - 0.5) * width * 0.5,
        vy: (Math.random() - 0.6) * height * 0.5,
        born: elapsed,
      });
  }
  function path(points) {
    context.beginPath();
    points.forEach((point, i) =>
      i ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y),
    );
    context.stroke();
  }
  function draw(elapsed) {
    if (!context) return;
    context.clearRect(0, 0, width, height);
    bolts = bolts.filter((bolt) => elapsed - bolt.born < 460);
    particles = particles.filter((particle) => elapsed - particle.born < 750);
    let impact = 0;
    for (const bolt of bolts) {
      const alpha = Math.pow(1 - (elapsed - bolt.born) / 460, 2);
      impact = Math.max(impact, alpha);
      context.globalAlpha = alpha;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.shadowColor = colors[0];
      context.shadowBlur = 16;
      context.strokeStyle = colors[0];
      context.lineWidth = 5;
      path(bolt.points);
      path(bolt.branch);
      context.shadowBlur = 4;
      context.strokeStyle = colors[1];
      context.lineWidth = 1.6;
      path(bolt.points);
      path(bolt.branch);
    }
    context.shadowBlur = 0;
    for (const particle of particles) {
      const age = (elapsed - particle.born) / 1000;
      context.globalAlpha = Math.max(0, 1 - age / 0.75);
      context.fillStyle = colors[1];
      context.beginPath();
      context.arc(
        particle.x + particle.vx * age,
        particle.y + particle.vy * age + 100 * age * age,
        1.5,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    context.globalAlpha = 1;
    scene.style.setProperty("--impact", String(impact * 0.32));
  }
  function tick(now) {
    if (disposed || !scene.isConnected || document.hidden || motion.matches) {
      finish();
      return;
    }
    const elapsed = now - started;
    const progress = Math.min(1, elapsed / duration);
    // Ease out over three full turns; the image and branded back share one 3D plane.
    const eased = 1 - Math.pow(1 - progress, 2.4);
    rotor.style.transform = `rotateY(${-1080 * (1 - eased)}deg) rotateX(${Math.sin(progress * Math.PI) * 9}deg) rotateZ(${Math.sin(progress * Math.PI * 2) * 3}deg) scale(${0.84 + 0.16 * eased})`;
    if (
      nextStrike < 3 &&
      elapsed >= [duration * 0.15, duration * 0.45, duration * 0.74][nextStrike]
    ) {
      strike(elapsed, eased);
      nextStrike++;
    }
    draw(elapsed);
    if (progress < 1) frame = requestAnimationFrame(tick);
    else finish();
  }
  async function play() {
    const token = ++generation;
    finish(false);
    scene.dataset.animation = "preparing";
    image.style.visibility = "hidden";
    seal.hidden = false;
    status.textContent = "Preparing artwork…";
    replay.disabled = true;
    try {
      await image.decode();
    } catch {
      if (token === generation) {
        finish(false);
        status.textContent = "Image could not load. Reload to retry.";
      }
      return;
    }
    if (token !== generation || disposed) return;
    if (motion.matches || document.hidden) {
      finish();
      return;
    }
    resize();
    nextStrike = 0;
    bolts = [];
    particles = [];
    running = true;
    scene.classList.add("is-spinning");
    scene.dataset.animation = "running";
    status.textContent = "Revealing your edition…";
    skip.hidden = Boolean(options.concealed);
    started = performance.now();
    frame = requestAnimationFrame(tick);
  }
  replay.onclick = () => play();
  skip.onclick = () => {
    generation++;
    finish();
  };
  function changedMotion() {
    if (motion.matches) {
      generation++;
      finish();
    }
  }
  function visibility() {
    if (document.hidden && running) {
      generation++;
      finish();
    }
  }
  motion.addEventListener("change", changedMotion);
  document.addEventListener("visibilitychange", visibility);
  function cleanup() {
    disposed = true;
    generation++;
    finish(false);
    observer.disconnect();
    motion.removeEventListener("change", changedMotion);
    document.removeEventListener("visibilitychange", visibility);
  }
  window.addEventListener("pagehide", cleanup, { once: true });
  play();
  return {
    play,
    stop: () => {
      generation++;
      finish();
    },
    cleanup,
  };
}

// Starts immediately on Buy while the checkout request runs in parallel.
// This stage never allocates a tier, confirms a payment or exposes artwork.
export function beginCheckoutOpening({ resale = false } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "foil-opening-dialog";
  const title = document.createElement("h2");
  title.id = "foil-opening-title";
  title.textContent = "Opening secure checkout";
  dialog.setAttribute("aria-labelledby", title.id);
  const message = document.createElement("p");
  message.textContent = resale
    ? "Preparing the transfer of this existing edition. Its tier will not change."
    : "Your rarity roll happens on the server after payment is confirmed. Tier caps apply.";
  const panel = document.createElement("article");
  panel.className = "foil-card foil-purchase-reveal";
  panel.dataset.tier = "Standard";
  const image = document.createElement("img");
  image.alt = "";
  image.src =
    "data:image/svg+xml," +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
  panel.append(image);
  const hide = document.createElement("button");
  hide.type = "button";
  hide.className = "buy-button";
  hide.textContent = "Hide effects";
  dialog.append(title, message, panel, hide);
  document.body.append(dialog);
  dialog.showModal();
  let resolve;
  const ready = new Promise((done) => {
    resolve = done;
  });
  const effect = mountFoilReveal(panel, image, {
    concealed: true,
    duration: 2200,
    onComplete: () => resolve(),
  });
  function close() {
    resolve();
    effect.cleanup();
    if (dialog.open) dialog.close();
    dialog.remove();
  }
  hide.onclick = close;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  return { ready, close };
}
