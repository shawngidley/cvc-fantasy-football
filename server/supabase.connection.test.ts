import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

describe("CVC Supabase connection", () => {
  it("reads the configured league table with the server-only credential", async () => {
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;

    expect(url).toBeTruthy();
    expect(secret).toBeTruthy();

    const supabase = createClient(url!, secret!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.from("league").select("id").limit(1);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});
