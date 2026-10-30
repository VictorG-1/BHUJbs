import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function env(key) {
  const line = fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}=`));
  return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false }
});

const names = [
  "Anant javeri",
  "Yogesh bhutada",
  "Bhaumik jitendra chandak",
  "Bhavesh Ratanshi Chandak",
  "MALTIBEN ISHWARLAL SHETH",
  "Damyantiben Premji Somani",
  "Shilpa Mansukh Mundada",
  "HARIKRISHNA NAVDHARE",
  "ANIL BHUTADA",
  "Daksha shah",
  "Meena Naresh Jhaveri",
  "Gitesh M Navdhare",
  "Bhanumati Vallabhadas Mandan",
  "Vallabhdas Virji Mandan"
];

const { data: codeHits, error: codeError } = await db
  .from("families")
  .select("id, registration_code, head_name, city")
  .ilike("registration_code", "%0E0F503%");
if (codeError) throw codeError;

const hits = [];
for (const name of names) {
  const { data, error } = await db
    .from("members")
    .select("id, name, mobile, family_id, families(registration_code, head_name, city, registration_type)")
    .ilike("name", `%${name.split(" ")[0]}%`);
  if (error) throw error;
  const filtered = (data ?? []).filter((row) => row.name.toLowerCase().includes(name.split(" ").at(-1).toLowerCase()) || row.name.toLowerCase().includes(name.toLowerCase().slice(0, 8)));
  hits.push({ name, count: filtered.length, rows: filtered.slice(0, 8).map((row) => ({ name: row.name, code: row.families?.registration_code, city: row.families?.city, type: row.families?.registration_type, mobile: row.mobile })) });
}

console.log(JSON.stringify({ codeHits, hits }, null, 2));
