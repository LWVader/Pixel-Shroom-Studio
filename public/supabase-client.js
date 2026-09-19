import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

if (SUPABASE_URL.includes("YOUR_PROJECT") || SUPABASE_ANON_KEY.includes("YOUR_PUBLIC")) {
  throw new Error("Create public/config.js from config.example.js and add your Supabase public project values.");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

export function functionUrl(name) {
  return `${SUPABASE_URL}/functions/v1/${name}`;
}

export async function invoke(name, body, accessToken = SUPABASE_ANON_KEY) {
  const response = await fetch(functionUrl(name), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export const mapArtwork = (row) => ({
  id: row.id, title: row.title, artist: row.artist, category: row.category,
  serialNumber: row.serial_number, price: Number(row.price), previewUrl: row.preview_url,
  displayWidth: row.display_width, displayHeight: row.display_height, status: row.status,
  originalPath: row.original_path, createdAt: row.created_at
});
