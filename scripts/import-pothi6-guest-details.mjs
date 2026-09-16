import { createClient } from "@supabase/supabase-js";

const env = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value.replace(/^['"]|['"]$/g, "");
};
const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const guests = [
  ["Manilal Narayandas Gingal", 75, "male", "9974973039", "pothi"],
  ["Nalini Manilal Gingal", 72, "female", null, "pothi"],
  ["Shailesh Somchand Ladhad", 58, "male", "9341221902", "pothi"],
  ["Dhirti Shailesh Ladhad", 56, "female", null, "pothi"],
  ["Virendra Bapalal Seth", 54, "male", "9820083185", "private"],
  ["Heena Virendra Seth", 52, "female", null, "private"],
  ["Hetal Chetan Mall", 48, "female", "9033133411", "private"],
  ["Sheetal Bhavesh Karwa", 45, "female", "9029107371", "private"],
  ["Shewta Jenish Mall", 40, "female", null, "private"],
  ["Jenish Javerilal Mall", 42, "male", null, "private"],
  ["Javerilal Harilal Mall", 70, "male", null, "private"],
  ["Indira Javerilal Mall", 65, "female", null, "private"],
  ["Praghji Gopalji Mandan", 70, "male", null, "private"],
  ["Nanda Rajesh Mandan", 53, "female", null, "private"],
  ["Bharat Devkaran Savar", 69, "male", null, "private"],
  ["Ritesh Shivji Mall", 41, "male", null, "private"],
  ["Chunilal Haridas Bhutada", 78, "male", null, "private", true],
  ["Rasilaben Chnilal Bhutada", 73, "female", null, "private"],
  ["Deepak Haridas Bhutada", 63, "male", null, "private"],
];

const familyId = "3ee556ff-8c81-481a-b1ff-b5fc16db5f83";
const fail = (label, error) => { if (error) throw new Error(`${label}: ${error.message}`); };

let createdFamily = null;
let createdMembers = [];
let createdAllocations = [];
try {
  const { data: pothi, error: pothiError } = await supabase.from("pothis").select("id,family_id,contact_mobile").eq("id", 6).single();
  fail("loading Pothi 6", pothiError);
  if (pothi.family_id) throw new Error("Pothi 6 already has a registration; no data was changed.");

  const { data: family, error: familyError } = await supabase.from("families").insert({
    head_name: "Chunilal Haridas Bhutada",
    head_mobile: pothi.contact_mobile || "9724519204",
    city: "Bhuj",
    address: "Imported Pothi 6 guest details",
    wants_stay: true,
    pothi_id: 6,
    registration_type: "pothi_room",
    stay_from: "2026-11-13",
    stay_to: "2026-11-20",
  }).select("id,registration_code").single();
  fail("creating Pothi 6 family", familyError);
  createdFamily = family;

  const { error: pothiLinkError } = await supabase.from("pothis").update({ family_id: family.id }).eq("id", 6).is("family_id", null);
  fail("linking Pothi 6", pothiLinkError);

  const { data: members, error: memberError } = await supabase.from("members").insert(guests.map((guest) => ({
    family_id: family.id,
    name: guest[0], age: guest[1], gender: guest[2], mobile: guest[3], is_head: Boolean(guest[5]),
  }))).select("id,name");
  fail("creating Pothi 6 members", memberError);
  createdMembers = members;

  const rooms = {};
  for (const source of ["402", "403", "404", "405"]) {
    const { data, error } = await supabase.from("rooms").select("id,room_number,capacity").eq("linked_pothi_id", 6).eq("source_room_number", source).single();
    fail(`loading room ${source}`, error);
    rooms[source] = data;
  }
  const assignments = guests.map((_guest, index) => ({
    member_id: members[index].id,
    room_id: index < 4 ? rooms["405"].id : rooms[String(402 + Math.floor((index - 4) / 5))].id,
    family_id: family.id,
  }));
  const { data: allocations, error: allocationError } = await supabase.from("room_allocations").insert(assignments).select("id,room_id,member_id");
  fail("allocating Pothi 6 rooms", allocationError);
  createdAllocations = allocations;
  console.log(JSON.stringify({ familyId: family.id, registrationCode: family.registration_code, members: members.length, allocations: allocations.length, room405: 4, room402: 5, room403: 5, room404: 5 }));
} catch (error) {
  if (createdAllocations.length) await supabase.from("room_allocations").delete().in("id", createdAllocations.map((row) => row.id));
  if (createdMembers.length) await supabase.from("members").delete().in("id", createdMembers.map((row) => row.id));
  if (createdFamily) {
    await supabase.from("pothis").update({ family_id: null }).eq("id", 6).eq("family_id", createdFamily.id);
    await supabase.from("families").delete().eq("id", createdFamily.id);
  }
  console.error(error.message);
  process.exitCode = 1;
}
