import { createClient as createSupabaseClient } from "@supabase/supabase-js";

let client: ReturnType<typeof createSupabaseClient> | null = null;

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client ??= createSupabaseClient(url, key);
  return client;
}
