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
  auth: { persistSession: false },
});

const { data, error } = await db
  .from("rooms")
  .select(
    "id, room_number, venue_name, section_name, source_room_number, floor, capacity, room_type, owner_type, allotment_note, sort_order"
  )
  .or(
    [
      "room_number.ilike.%lohana%",
      "section_name.ilike.%lohana%",
      "venue_name.ilike.%lohana%",
      "room_number.ilike.%private%",
      "section_name.ilike.%private%",
      "source_room_number.ilike.%private%",
      "room_number.ilike.%shyam%",
      "section_name.ilike.%shyam%",
      "venue_name.ilike.%shyam%",
      "room_number.ilike.%v.s.c%",
      "section_name.ilike.%v.s.c%",
      "source_room_number.eq.01",
      "source_room_number.eq.1",
    ].join(",")
  );

if (error) throw error;
console.log(JSON.stringify(data, null, 2));
