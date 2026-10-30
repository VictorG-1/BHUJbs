import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function env(key) {
  const line = fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}=`));
  if (!line) throw new Error(`Missing ${key}`);
  return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false }
});

const codes = ["0FB5072A00", "D9C684D81F", "3D7DE8158B", "146D05C3FA", "282F76ADC0", "61AB5381DE"];
const { data: families, error } = await db
  .from("families")
  .select("id, registration_code, head_name, city, registration_type, members(id, name, mobile), room_allocations(member_id, rooms(room_number))")
  .in("registration_code", codes);
if (error) throw error;
console.log(JSON.stringify(families, null, 2));
