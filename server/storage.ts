// Storage helpers backed by Supabase Storage.
// Uploads go to the public `team-logos` bucket; the returned URL is the
// bucket's public object URL, safe to use directly in <img src>.

import { supabase } from "./supabase";

const TEAM_LOGO_BUCKET = "team-logos";

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const body = typeof data === "string" ? Buffer.from(data) : data;

  const { error } = await supabase.storage.from(TEAM_LOGO_BUCKET).upload(key, body, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: publicUrl } = supabase.storage.from(TEAM_LOGO_BUCKET).getPublicUrl(key);
  return { key, url: publicUrl.publicUrl };
}
