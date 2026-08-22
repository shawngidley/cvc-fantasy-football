import { readFile, writeFile } from "node:fs/promises";

const sql = await readFile("supabase/seeds/202608220002_cvc_placeholder_data.sql", "utf8");
await writeFile("supabase/cvc_placeholder_seed_payload.json", JSON.stringify({
  project_id: "qrfmcxyudfozjmlfpjea",
  query: sql,
}));
