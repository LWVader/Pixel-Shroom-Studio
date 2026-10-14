// Reviewed protected previews; apply only while the stored genre is the old assignment.
export const GENRE_CORRECTIONS = {
  "LWV-1076123371": { from: "Portrait", to: "Dark Fantasy" },
  "LWV-1317546991": { from: "Portrait", to: "Horror" },
  "LWV-8400430249": { from: "Portrait", to: "Fantasy" },
  "LWV-5714104482": { from: "Portrait", to: "Fantasy" },
  "LWV-6821652269": { from: "Portrait", to: "Dark Fantasy" },
  "LWV-7332630323": { from: "Fantasy", to: "Dark Fantasy" },
};
export function correctedArtwork(row) {
  const change = GENRE_CORRECTIONS[String(row.serial_number).toUpperCase()];
  return change && row.category === change.from ? { ...row, category: change.to } : row;
}
export const FEATURED_SERIALS = ["LWV-3460579484", "LWV-8400430249", "LWV-9097029304"];
