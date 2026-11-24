import {industries} from "./industries.js";
import {exampleArtworkPath, legacyArtworkDirectory} from "./campaign-artwork-paths.js";

const cases = {
  orbit: {
    name: "Orbit Roast", image: "orbit-roast",
    alt: "A giant coffee bean hangs above a violet city at night.",
    brief: "An independent roaster wants to launch a bold midnight blend.",
    value: "The oversized bean keeps the product legible in a small feed, while a lime orbit and violet skyline give the blend its own visual world.",
    colors: ["#100C24", "#462294", "#853AE8", "#DBFF5D"], tagline: "Your morning, from another planet."
  },
  boom: {
    name: "Boom Bun", image: "boom-bun",
    alt: "A small terrier runs through a diner with a burger.",
    brief: "A retro diner needs a playful launch visual for its signature cheeseburger.",
    value: "A dog mid-heist gives the ad a story in one frame. Bright ketchup red and diner teal make the campaign easy to recognize.",
    colors: ["#A52330", "#F97B66", "#2F8C97", "#FFE0B5"], tagline: "Gone before the first bite."
  },
  moss: {
    name: "Mossbyte Games", image: "mossbyte",
    alt: "An astronaut explores an alien forest beside an enormous pink mushroom.",
    brief: "A gaming studio wants its first reveal to feel like stepping into a mysterious playable world.",
    value: "The tiny explorer sets a scale the viewer understands, while the impossible glow promises a world worth discovering.",
    colors: ["#182B24", "#465348", "#BD5B77", "#FEB6A8"], tagline: "Small explorer. Strange planet."
  },
  static: {
    name: "Static Bloom", image: "static-bloom",
    alt: "A jellyfish made from chrome headphones floats above violet rooftops.",
    brief: "An electronic artist needs a visual hook for a nocturnal synth EP.",
    value: "The headphones immediately cue music. Bioluminescent cables and a twilight skyline translate the EP's sound into an image.",
    colors: ["#221333", "#593087", "#C82FB4", "#EE9ACD"], tagline: "Something is listening."
  },
  sole: {
    name: "Midnight Sole", image: "midnight-sole",
    alt: "Black and lime streetwear sneaker splashes into an urban pool.",
    brief: "A streetwear label wants a dramatic reveal for a black-and-lime high-top.",
    value: "A low camera angle and an electric splash make the shoe feel monumental while keeping the silhouette and materials clear.",
    colors: ["#110F14", "#343641", "#829139", "#DAFF39"], tagline: "Made for after dark."
  }
};

const filterButtons = [...document.querySelectorAll("[data-filter]")];
const cards = [...document.querySelectorAll("[data-case]")];
function filterCards(selected) {
  const sector = selected.dataset.filter;
  for (const button of filterButtons) button.setAttribute("aria-pressed", String(button === selected));
  document.querySelector("#work").dataset.industry = sector;
  let count = 0;
  for (const card of cards) {
    card.hidden = sector !== "all" && sector !== card.dataset.sector;
    if (!card.hidden) count++;
  }
  document.querySelector("#filter-status").textContent = count === 1 ? "1 campaign shown" : `${count} campaigns shown`;
}
for (const button of filterButtons) button.addEventListener("click", () => filterCards(button));

function addFilter(sector) {
  if (filterButtons.some((button) => button.dataset.filter === sector)) return;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.filter = sector;
  button.textContent = industries[sector] || industries.other;
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => filterCards(button));
  filterButtons.push(button);
  document.querySelector(".filters").append(button);
}

const dialog = document.querySelector("#case-dialog");
const shareLink = document.createElement("a");
shareLink.textContent = "Open shareable campaign page";
shareLink.className = "text-link campaign-share-link";
shareLink.hidden = true;
dialog?.querySelector(".case-copy").append(shareLink);

function openCase(study) {
  dialog.querySelector("#case-title").textContent = study.name;
  dialog.querySelector("#case-brand").textContent = study.name;
  dialog.querySelector("#case-brief").textContent = study.brief;
  dialog.querySelector("#case-value").textContent = study.value;
  dialog.querySelector("#case-tagline").textContent = study.tagline;
  const mainImage = dialog.querySelector(".case-image");
  mainImage.alt = study.alt;
  mainImage.classList.toggle("uploaded-art", Boolean(study.imageUrl));
  mainImage.src = study.imageUrl || exampleArtworkPath(`${legacyArtworkDirectory}${study.image}.webp`);
  shareLink.hidden = !study.sharePath;
  if (study.sharePath) shareLink.href = study.sharePath;
  else shareLink.removeAttribute("href");
  dialog.querySelector(".mockup-image").src = mainImage.src;
  const palette = dialog.querySelector("#case-palette");
  palette.previousElementSibling.hidden = palette.hidden = !study.colors.length;
  palette.replaceChildren(...study.colors.map((color) => {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.backgroundColor = color;
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, color);
    return item;
  }));
  if (!dialog.open) dialog.showModal();
}

for (const card of cards) {
  const image = card.querySelector("img[src]");
  const preview = image && exampleArtworkPath(new URL(image.src).pathname);
  if (preview) image.src = preview;
  card.addEventListener("click", () => openCase(cases[card.dataset.case]));
}

const workGrid = document.querySelector(".work-grid");
if (workGrid) {
  const more = document.querySelector("#more-work");
  const published = new Map();
  let offset = 0;

  async function loadPublished() {
    more.disabled = true;
    try {
      const response = await fetch(`/api/portfolio?offset=${offset}`);
      if (!response.ok) return;
      const data = await response.json();
      const added = [];
      for (const study of data.campaigns) {
        if (published.has(study.id)) continue;
        published.set(study.id, study);
        const card = document.createElement("button");
        card.className = "work-card";
        card.type = "button";
        card.dataset.sector = study.sector;
        card.setAttribute("aria-haspopup", "dialog");
        const img = document.createElement("img");
        img.src = study.imageUrl;
        img.alt = study.alt;
        img.loading = "lazy";
        img.width = 960;
        img.height = 640;
        const info = document.createElement("span");
        info.className = "card-info";
        const copy = document.createElement("span");
        const category = document.createElement("small");
        category.textContent = industries[study.sector] || industries.other;
        const title = document.createElement("strong");
        title.textContent = study.name;
        copy.append(category, title);
        info.append(copy);
        card.append(img, info);
        card.addEventListener("click", () => openCase(study));
        cards.push(card);
        added.push(card);
        addFilter(study.sector);
      }
      if (offset === 0) workGrid.prepend(...added);
      else workGrid.append(...added);
      offset += data.campaigns.length;
      more.hidden = !data.more;
      filterCards(filterButtons.find((button) => button.getAttribute("aria-pressed") === "true"));
    } catch {
      // The five bundled examples remain available if the portfolio API is offline.
    } finally {
      more.disabled = false;
    }
  }

  more.addEventListener("click", loadPublished);
  const requested = new URL(location.href).searchParams.get("campaign");
  void loadPublished().then(async () => {
    if (!/^[a-f0-9-]{36}$/.test(requested || "")) return;
    if (published.has(requested)) {
      openCase(published.get(requested));
      return;
    }
    try {
      const response = await fetch(`/api/portfolio?id=${encodeURIComponent(requested)}`);
      if (response.ok) openCase(await response.json());
    } catch { /* The gallery remains available. */ }
  });
}

dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

export async function campaignApi(action, body = {}) {
  const response = await fetch("/api/campaign-orders", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({action, ...body})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Please try again in a moment.");
  return data;
}

export function wireCheckout(button, status, extra = {}) {
  let requestId;
  button.addEventListener("click", async () => {
    requestId ??= crypto.randomUUID();
    button.disabled = true;
    status.textContent = "Opening Stripe Checkout…";
    try {
      const data = await campaignApi("checkout", {offer: button.dataset.checkout, requestId, ...extra});
      const checkout = new URL(data.url);
      if (checkout.protocol !== "https:" || checkout.hostname !== "checkout.stripe.com") {
        throw new Error("Stripe Checkout is unavailable. Email the studio for help.");
      }
      location.assign(checkout.href);
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });
}

const attention = document.querySelector('[data-checkout="attention"]');
if (attention) {
  const status = document.querySelector("#order-status");
  campaignApi("offers").then((offers) => {
    attention.disabled = !offers.attention;
    if (offers.attention) {
      wireCheckout(attention, status);
      status.textContent = "Secure checkout through Stripe.";
    } else {
      status.replaceChildren("Online checkout is currently unavailable. ");
      const contact = document.createElement("a");
      contact.href = "mailto:lwvader@pixelshroomstudio.com?subject=Attention%20Pack";
      contact.textContent = "Email about an order.";
      status.append(contact);
    }
    if (offers.monthly) {
      const monthly = document.querySelector("#monthly");
      monthly.hidden = false;
      const button = monthly.querySelector('button[data-checkout="monthly"]');
      button.disabled = false;
      wireCheckout(button, monthly.querySelector("[data-monthly-status]"));
      const link = monthly.querySelector("[data-billing-link]");
      link.href = offers.billingPortal;
      link.hidden = false;
    }
  }).catch(() => {
    status.textContent = "Checkout is temporarily unavailable. Email the studio for help.";
  });
}
