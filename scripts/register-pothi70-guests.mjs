import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const localEnv = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, "$2")];
    })
);

const supabase = createClient(localEnv.SUPABASE_URL, localEnv.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});
const guests = [
  { name: "Maltiben Iswarlal Shah", age: 50, gender: "female" },
  { name: "Hetalben Devang Gandhi", age: 42, gender: "female" },
  { name: "Bhavin R Gandhi", age: 50, gender: "male" },
  { name: "Pravinaben Jagdishbhai Rathi", age: 45, gender: "female" },
  { name: "Mahesh Morarji Sheth", age: 71, gender: "male", is_head: true }
];
const pothiId = 70;
const fail = (label, error) => {
  if (error) throw new Error(`${label}: ${error.message}`);
};

let family;
let members = [];
let allocations = [];
try {
  const { data: pothi, error: pothiError } = await supabase
    .from("pothis")
    .select("id,family_id,primary_holder_name,city,contact_mobile")
    .eq("id", pothiId)
    .single();
  fail("Loading Pothi 70", pothiError);
  if (pothi.family_id) throw new Error("Pothi 70 already has a registration; no data was changed.");

  const { data: existingFamily, error: existingFamilyError } = await supabase
    .from("families")
    .select("id")
    .eq("head_mobile", pothi.contact_mobile)
    .maybeSingle();
  fail("Checking mapped contact", existingFamilyError);
  if (existingFamily) throw new Error("The mapped contact already has a family registration; no data was changed.");

  const { data: matchingMembers, error: matchingMembersError } = await supabase
    .from("members")
    .select("id,name")
    .in("name", guests.map((guest) => guest.name));
  fail("Checking guest duplicates", matchingMembersError);
  if (matchingMembers?.length) {
    throw new Error(`Matching members already exist (${matchingMembers.map((member) => member.name).join(", ")}); no data was changed.`);
  }

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id,room_number,capacity")
    .eq("linked_pothi_id", pothiId)
    .eq("owner_type", "SAMAJ")
    .eq("room_type", "pothi_room")
    .single();
  fail("Loading Pothi room", roomError);
  const { data: occupied, error: occupiedError } = await supabase
    .from("room_allocations")
    .select("id")
    .eq("room_id", room.id);
  fail("Checking room occupancy", occupiedError);
  if (room.capacity < guests.length || (occupied?.length ?? 0) + guests.length > room.capacity) {
    throw new Error(`Room ${room.room_number} cannot fit all ${guests.length} guests; no data was changed.`);
  }

  const { data: createdFamily, error: familyError } = await supabase
    .from("families")
    .insert({
      head_name: "Mahesh Morarji Sheth",
      head_mobile: pothi.contact_mobile,
      city: pothi.city,
      address: "Admin entry for Pothi 70",
      wants_stay: true,
      pothi_id: pothiId,
      registration_type: "pothi_room",
      stay_from: "2026-11-13",
      stay_to: "2026-11-20"
    })
    .select("id,registration_code")
    .single();
  fail("Creating Pothi 70 registration", familyError);
  family = createdFamily;

  const { data: linkedPothi, error: linkError } = await supabase
    .from("pothis")
    .update({ family_id: family.id, locked_at: new Date().toISOString() })
    .eq("id", pothiId)
    .is("family_id", null)
    .select("id")
    .maybeSingle();
  fail("Linking Pothi 70", linkError);
  if (!linkedPothi) throw new Error("Pothi 70 could not be linked to the new registration.");

  const { data: insertedMembers, error: membersError } = await supabase
    .from("members")
    .insert(guests.map((guest) => ({ ...guest, is_head: guest.is_head ?? false, family_id: family.id, mobile: null })))
    .select("id,name");
  fail("Adding guests", membersError);
  members = insertedMembers ?? [];

  const { data: insertedAllocations, error: allocationError } = await supabase
    .from("room_allocations")
    .insert(members.map((member) => ({ family_id: family.id, member_id: member.id, room_id: room.id })))
    .select("id");
  fail("Allocating room 915", allocationError);
  allocations = insertedAllocations ?? [];

  console.log(JSON.stringify({ pothi: pothiId, registrationCode: family.registration_code, guests: members.length, venue: "YAX MANDIR / JAKHIBAI COMPLEX", room: room.room_number, capacity: room.capacity, stay: "2026-11-13 to 2026-11-20" }));
} catch (error) {
  if (allocations.length) await supabase.from("room_allocations").delete().in("id", allocations.map((row) => row.id));
  if (members.length) await supabase.from("members").delete().in("id", members.map((row) => row.id));
  if (family) {
    await supabase.from("pothis").update({ family_id: null, locked_at: null }).eq("id", pothiId).eq("family_id", family.id);
    await supabase.from("families").delete().eq("id", family.id);
  }
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
