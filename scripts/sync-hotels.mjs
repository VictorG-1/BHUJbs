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

const rooms = JSON.parse(fs.readFileSync("src/data/rooms.json", "utf8")).filter(
  (room) => room.venue_name === "HOTEL"
);

const payload = rooms.map((room) => ({
  room_number: room.room_number,
  venue_name: room.venue_name,
  section_name: room.section_name,
  source_room_number: room.source_room_number,
  floor: room.floor,
  ac_type: room.ac_type,
  bed_count: room.bed_count,
  extra_count: room.extra_count,
  owner_type: room.owner_type,
  linked_pothi_id: room.linked_pothi_id,
  allotment_note: room.allotment_note,
  room_type: room.room_type,
  sort_order: room.sort_order,
  capacity: room.total_capacity
}));

const { error: upsertError } = await db.from("rooms").upsert(payload, { onConflict: "room_number" });
if (upsertError) throw upsertError;

const { data: existing, error: existingError } = await db
  .from("rooms")
  .select("id, room_number")
  .eq("venue_name", "HOTEL");
if (existingError) throw existingError;

const keep = new Set(payload.map((room) => room.room_number));
const stale = (existing ?? []).filter((room) => !keep.has(room.room_number));
if (stale.length) {
  const { error: deleteError } = await db.from("rooms").delete().in(
    "id",
    stale.map((room) => room.id)
  );
  if (deleteError) throw deleteError;
}

console.log(
  JSON.stringify({
    upserted: payload.length,
    removed: stale.map((room) => room.room_number)
  })
);
