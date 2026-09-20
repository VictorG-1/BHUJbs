import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const readEnv = (key) => {
  const line = fs.readFileSync(".env.local", "utf8").split(/\r?\n/).find((item) => item.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
};

const supabase = createClient(readEnv("SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const { data: allRooms, error: roomError } = await supabase
  .from("rooms")
  .select("id,venue_name,section_name,source_room_number,room_number,room_type,capacity,linked_pothi_id,sort_order")
  .order("sort_order");
if (roomError) throw roomError;
const rooms = (allRooms ?? []).filter((room) => /yax|yaksh|vbc|vagad/i.test(`${room.venue_name} ${room.section_name} ${room.room_number}`));

const ids = (rooms ?? []).map((room) => room.id);
const { data: allocations, error: allocationError } = await supabase.from("room_allocations").select("room_id,member_id").in("room_id", ids);
if (allocationError) throw allocationError;

const wantedMobiles = ["9427064270","9428032673","8469032577","9322233482","9821427837","9482995803","9879874788","9426381550","7041097789","9909577711","9429822835","9909814444","9060998888","9322047980","8850260050","9869122607","9322272035","9920532035","9820652245","9833965438","9820643700","9322291916","9320007962","8422098241","9819937546","9343401740","8296689888"];
const { data: existingMembers, error: memberError } = await supabase.from("members").select("id,name,mobile,family_id").in("mobile", wantedMobiles);
if (memberError) throw memberError;
const familyIds = [...new Set((existingMembers ?? []).map((member) => member.family_id))];
const { data: existingFamilies, error: familyError } = familyIds.length
  ? await supabase.from("families").select("id,head_name,head_mobile,registration_type,pothi_id,stay_from,stay_to,registration_code").in("id", familyIds)
  : { data: [], error: null };
if (familyError) throw familyError;
const { data: familyMembers, error: familyMemberError } = familyIds.length
  ? await supabase.from("members").select("family_id,name,mobile,age,gender").in("family_id", familyIds).order("created_at")
  : { data: [], error: null };
if (familyMemberError) throw familyMemberError;

const result = (rooms ?? []).map((room) => {
  const occupied = (allocations ?? []).filter((allocation) => allocation.room_id === room.id).length;
  return { venue: room.venue_name, section: room.section_name, source_room: room.source_room_number, room: room.room_number, type: room.room_type, capacity: room.capacity, occupied, available: room.capacity - occupied, linked_pothi: room.linked_pothi_id };
});
console.log(JSON.stringify({ rooms: result, existingMembers: existingMembers ?? [], existingFamilies: existingFamilies ?? [], familyMembers: familyMembers ?? [] }, null, 2));
