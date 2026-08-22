import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

if (!url || !secret) {
  throw new Error("CVC Supabase server configuration is incomplete");
}

export const supabase = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export function unwrap<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Supabase query failed: ${result.error.message}`);
  return result.data;
}
