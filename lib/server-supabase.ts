import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DocumentError } from "./document-errors";

export type AuthorizedContext = {
  supabase: SupabaseClient;
  firmId: string;
  author: { full_name: string };
};

export async function authorizeDocumentRequest(request: Request): Promise<AuthorizedContext> {
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new DocumentError(401, "unauthorized", "Sign in to load your firm's CRM data.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new DocumentError(503, "unavailable", "Document generation is unavailable until your firm connects its CRM.");

  // Use the user's JWT so RLS remains active; never use the service-role key here.
  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) throw new DocumentError(401, "unauthorized", "Your session has expired. Sign in again.");
  const { data: profile, error: profileError } = await supabase.from("profiles").select("firm_id, full_name").eq("id", user.id).maybeSingle();
  if (profileError) throw new DocumentError(500, "crm_error", "Unable to load your firm membership. Try again.");
  if (!profile?.firm_id) throw new DocumentError(403, "forbidden", "Your account needs a firm profile before generating documents.");
  return { supabase, firmId: profile.firm_id, author: { full_name: profile.full_name } };
}
