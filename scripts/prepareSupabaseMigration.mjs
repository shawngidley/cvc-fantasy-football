import { readFile, writeFile } from "node:fs/promises";

const sql = await readFile("supabase/migrations/202608220001_cvc_league_domain.sql", "utf8");
const payload = {
  project_id: "qrfmcxyudfozjmlfpjea",
  name: "create_cvc_league_domain",
  query: sql,
};

await writeFile("supabase/cvc_league_domain_payload.json", JSON.stringify(payload));
