import { json } from "./cors.ts";
import { serviceClient } from "./supabase.ts";

export async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return { error: json({ error: "Admin login required." }, 401) };

  const supabase = serviceClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return { error: json({ error: "Invalid admin session." }, 401) };

  const { data: profile, error: profileError } = await supabase
    .from("admin_profiles")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) return { error: json({ error: "Admin access required." }, 403) };

  return { supabase, user: userData.user };
}
