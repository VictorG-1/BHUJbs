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

const url = env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
const anon = env("VITE_SUPABASE_ANON_KEY") || env("SUPABASE_ANON_KEY");
const db = createClient(url, key, { auth: { persistSession: false } });

const countRes = await fetch(`${url}/rest/v1/meal_qr_codes?select=id`, {
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Prefer: "count=exact",
    "Range-Unit": "items",
    Range: "0-0",
  },
});
console.log("meal_qr_codes", countRes.headers.get("content-range"));

const { data: sample, error: sampleError } = await db
  .from("meal_qr_codes")
  .select("qr_value, member_name, room")
  .limit(1)
  .single();
if (sampleError) throw sampleError;
console.log("sample", sample.member_name, sample.room);

const fn = await fetch(`${url}/functions/v1/validate-qr`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${anon}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ payload: sample.qr_value, mealType: "breakfast" }),
});
console.log("validate-qr", fn.status, (await fn.text()).slice(0, 160));

const { count: staff } = await db
  .from("admin_profiles")
  .select("*", { count: "exact", head: true })
  .in("role", ["admin", "subadmin"]);
console.log("staff_profiles", staff);
