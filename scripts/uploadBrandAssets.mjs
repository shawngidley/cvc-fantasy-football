// One-off script: backs up the static brand assets in client/public/brand/
// (favicon, PWA icons, backgrounds, header crest, social-share image — the
// files rescued from Manus storage before it went down) into a public
// Supabase Storage bucket, so a copy survives outside git too.
//
// Requires SUPABASE_URL / SUPABASE_SECRET_KEY in the environment.
// Usage: node scripts/uploadBrandAssets.mjs

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

const BRAND_DIR = path.resolve(import.meta.dirname, "..", "client", "public", "brand");
const BUCKET = "brand-assets";

const FILES = [
  "favicon-64.png",
  "apple-touch-icon.png",
  "social-share.jpg",
  "pwa-192.png",
  "pwa-512.png",
  "pwa-maskable-512.png",
  "header-crest.png",
  "stadium-night.webp",
  "turf-texture.webp",
  "stadium-crowd.webp",
];

const CONTENT_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

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

  for (const file of FILES) {
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

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(file, buffer, { contentType, upsert: true });
    if (uploadError) {
      console.error(`FAILED upload for ${file}: ${uploadError.message}`);
      continue;
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(file);
    console.log(`OK ${file}: ${publicUrlData.publicUrl}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
