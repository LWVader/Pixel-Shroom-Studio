(() => {
  const pack = document.querySelector("#pack");
  const offer = pack?.querySelector(".offer");
  const card = pack?.querySelector(".price-card");
  if (!offer || !card || pack.classList.contains("pss-christmas")) return;

  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = new URL("theme.css", document.currentScript.src);
  stylesheet.addEventListener("load", decorate, {once: true});
  document.head.append(stylesheet);

  function decorate() {
    const lights = document.createElement("div");
    lights.className = "pss-xmas-garland";
    lights.setAttribute("aria-hidden", "true");

    for (let strand = 0; strand < 4; strand += 1) {
      const cord = document.createElement("span");
      cord.className = "pss-xmas-cord";
      for (let bulb = 0; bulb < 7; bulb += 1) {
        const light = document.createElement("i");
        cord.append(light);
      }
      lights.append(cord);
    }

    const bow = document.createElement("span");
    bow.className = "pss-xmas-bow";
    bow.setAttribute("aria-hidden", "true");
    const garlandBow = bow.cloneNode(true);
    garlandBow.classList.add("pss-xmas-garland-bow");

    const snowman = document.createElement("span");
    snowman.className = "pss-xmas-snowman";
    snowman.setAttribute("aria-hidden", "true");
    const bauble = document.createElement("i");
    bauble.className = "pss-xmas-bauble";
    snowman.append(bauble);

    const motion = document.createElement("button");
    motion.type = "button";
    motion.className = "pss-xmas-motion";
    motion.textContent = "Pause decorations";
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => { motion.hidden = motionPreference.matches; };
    motionPreference.addEventListener("change", syncMotion);
    syncMotion();
    motion.addEventListener("click", () => {
      const paused = pack.classList.toggle("pss-xmas-paused");
      motion.textContent = paused ? "Resume decorations" : "Pause decorations";
    });

    pack.prepend(lights, garlandBow);
    card.prepend(bow);
    const footer = document.createElement("div");
    footer.className = "pss-xmas-footer";
    footer.append(motion, snowman);
    offer.append(footer);
    pack.classList.add("pss-christmas");
  }
})();
