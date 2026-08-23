// One-off script: uploads the 10 franchise logo files from client/public/brand/
// into the Supabase `team-logos` storage bucket and sets each franchise's
// logo_url. Requires SUPABASE_URL / SUPABASE_SECRET_KEY in the environment.
//
// Usage: node scripts/uploadFranchiseLogos.mjs

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const BRAND_DIR = path.resolve(import.meta.dirname, "..", "client", "public", "brand");
const BUCKET = "team-logos";

const LOGO_MAP = [
  { file: "xavier.png", franchise: "Xavier Musketeers" },
  { file: "shepards.png", franchise: "Shepard's Pie" },
  { file: "hardtimes.png", franchise: "Heiden's Hardtimes" },
  { file: "warteaters.png", franchise: "DS Warteaters" },
  { file: "devices.png", franchise: "Dresser Drawer Devices" },
  { file: "millertime.png", franchise: "Miller Time" },
  { file: "snuffles.png", franchise: "The Super Snuffleupagus" },
  { file: "legends.png", franchise: "The Legends" },
  { file: "foreskins.jpeg", franchise: "Washington Foreskins" },
  { file: "twinsburg.png", franchise: "The Rusty Trombones" },
];

const CONTENT_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

function appendHashSuffix(relKey) {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    console.error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set.");
    process.exit(1);
  }
  const supabase = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
  if (bucketsError) throw new Error(`Failed to list buckets: ${bucketsError.message}`);
  if (!buckets.some(b => b.id === BUCKET)) {
    const { error: createError } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (createError) throw new Error(`Failed to create bucket "${BUCKET}": ${createError.message}`);
    console.log(`Created public bucket "${BUCKET}".`);
  }

  const { data: franchises, error: franchiseError } = await supabase
    .from("franchise")
    .select("id, name")
    .eq("is_active", true);
  if (franchiseError) throw new Error(`Failed to load franchises: ${franchiseError.message}`);

  const franchiseByName = new Map(franchises.map(f => [f.name.trim().toLowerCase(), f]));

  for (const { file, franchise } of LOGO_MAP) {
    const match = franchiseByName.get(franchise.trim().toLowerCase());
    if (!match) {
      console.warn(`SKIP ${file}: no active franchise named "${franchise}" found.`);
      continue;
    }

    const filePath = path.join(BRAND_DIR, file);
    let buffer;
    try {
      buffer = await readFile(filePath);
    } catch {
      console.warn(`SKIP ${file}: file not found at ${filePath}.`);
      continue;
    }

    const ext = path.extname(file).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    const key = appendHashSuffix(`franchise-logos/${match.id}${ext}`);

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(key, buffer, { contentType, upsert: true });
    if (uploadError) {
      console.error(`FAILED upload for ${franchise} (${file}): ${uploadError.message}`);
      continue;
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(key);
    const { error: updateError } = await supabase.from("franchise").update({ logo_url: publicUrlData.publicUrl }).eq("id", match.id);
    if (updateError) {
      console.error(`FAILED to set logo_url for ${franchise}: ${updateError.message}`);
      continue;
    }

    console.log(`OK ${franchise}: ${publicUrlData.publicUrl}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
