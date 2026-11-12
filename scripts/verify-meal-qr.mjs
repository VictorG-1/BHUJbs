import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i);
  let v = line.slice(i + 1);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const head = await fetch(`${url}/rest/v1/meal_qr_codes?select=id`, {
  headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact", "Range-Unit": "items", Range: "0-0" },
});
console.log("content-range", head.headers.get("content-range"));
const sample = await fetch(`${url}/rest/v1/meal_qr_codes?select=member_name,category,qr_value&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
console.log(await sample.json());
