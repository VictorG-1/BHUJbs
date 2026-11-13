import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function env(key) {
  const line = fs
    .readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}=`));
  if (!line) return process.env[key];
  return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

const db = createClient(env("SUPABASE_URL") || env("VITE_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const { data: profiles, error } = await db
  .from("admin_profiles")
  .select("user_id, role, display_name, created_at")
  .in("role", ["admin", "subadmin"])
  .order("role")
  .order("created_at");
if (error) throw error;

const rows = [];
for (const profile of profiles ?? []) {
  const { data } = await db.auth.admin.getUserById(profile.user_id);
  rows.push({
    email: data?.user?.email ?? "(no email)",
    role: profile.role,
    display_name: profile.display_name ?? "",
  });
}
console.log(JSON.stringify(rows, null, 2));
console.log("count", rows.length);
