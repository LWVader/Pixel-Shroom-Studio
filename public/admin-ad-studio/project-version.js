import {AdPalette} from "./ad-palette.js";

export const PROJECT_SCHEMA_VERSION = 1;

// The unversioned palette/layout editor stored half-speed timeline units.
// Earlier files without half-speed editor markers are treated as playback seconds.
const projectMigrations = [
  (project) => {
    const oldProduct = ["canvas", "box"].includes(project.model);
    const motions = {zoom: "weather", portal: "weather", "page-peel": "melt", lava: "melt"};
    const palette = AdPalette.normalize(project.palette);
    const duration = Number(project.duration);
    const halfSpeed = Boolean(project.layout || Object.hasOwn(project, "weatherLayer") || (duration > 0 && duration < 6));
    const data = {...project, schemaVersion: 1,
      duration: Number.isFinite(duration) && duration > 0 ? duration * (halfSpeed ? 2 : 1) : 12,
      palette: palette || AdPalette.fromLegacy(project) || AdPalette.defaultPalette,
      paletteName: palette ? project.paletteName : ""};
    if (Object.hasOwn(motions, data.motion)) data.motion = motions[data.motion];
    if (data.weatherType === "embers") {
      data.motion = "page-burn";
      data.burnEmbers = true;
      data.weatherType = "snow";
    }
    if (Object.hasOwn(data, "bgMode") && data.bgMode !== "image") data.bgImage = null;
    if (Object.hasOwn(data, "outerMode") && data.outerMode !== "image") data.outerImage = null;
    if (oldProduct) {
      data.model = "shroom";
      data.characterImage = null;
      const photo = data.faceImages?.front || data.image;
      if (!data.bgImage && typeof photo === "string" && photo.startsWith("data:image/")) data.bgImage = photo;
    }
    return data;
  }
];

export function migrateAdProject(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("Invalid project.");
  const version = Object.hasOwn(data, "schemaVersion") ? data.schemaVersion : 0;
  if (!Number.isInteger(version) || version < 0 || version > PROJECT_SCHEMA_VERSION) {
    throw Error("This project version is unsupported.");
  }
  for (let step = version; step < PROJECT_SCHEMA_VERSION; step++) data = projectMigrations[step](data);
  return data;
}
