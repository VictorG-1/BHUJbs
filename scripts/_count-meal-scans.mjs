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

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const { count } = await db.from("meal_scans").select("*", { count: "exact", head: true });
console.log("total meal_scans", count);
const { data } = await db
  .from("meal_scans")
  .select("id, meal_type, scan_date, scanned_at, meal_qr_codes(member_name, room)")
  .order("scanned_at", { ascending: false })
  .limit(10);
console.log(JSON.stringify(data, null, 2));
