import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const baseDir = process.cwd();
const pothis = JSON.parse(fs.readFileSync(path.join(baseDir, "src", "data", "pothis.json"), "utf8"));
const rooms = JSON.parse(fs.readFileSync(path.join(baseDir, "src", "data", "rooms.json"), "utf8"));

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

async function main() {
  const pothiPayload = pothis.map((pothi) => ({
    id: pothi.id,
    primary_holder_name: pothi.primary_holder_name,
    city: pothi.city,
    co_holders: pothi.co_holders ?? [],
    handover_name: pothi.handover_name,
    contact_name: pothi.contact_name,
    contact_mobile: pothi.contact_mobile
  }));

  const roomPayload = rooms.map((room) => ({
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

  const { error: pothiError } = await supabase.from("pothis").upsert(pothiPayload, {
    onConflict: "id"
  });
  if (pothiError) throw pothiError;

  const { error: roomError } = await supabase.from("rooms").upsert(roomPayload, {
    onConflict: "room_number"
  });
  if (roomError) throw roomError;

  console.log(`Synced ${pothiPayload.length} pothis and ${roomPayload.length} rooms.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
