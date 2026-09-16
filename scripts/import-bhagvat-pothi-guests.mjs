import { createClient } from "@supabase/supabase-js";

const env = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value.replace(/^['"]|['"]$/g, "");
};

const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stayFrom = "2026-11-13";
const stayTo = "2026-11-20";
const groups = [
  {
    pothi: 61,
    guests: [
      ["PADAMSHI MANJI RATHI", 74, "9820922101", "male"],
      ["MANILAL MANJI RATHI", 68, "9820392336", "male"],
      ["KIRAN JAMNADAS RATHI", 54, "9820092022", "female"],
      ["ROHAN PADAMSHI RATHI", 42, "9833076641", "male"],
      ["YASH MANILAL RATHI", 38, "9987578424", "male"],
    ],
  },
  {
    pothi: 62,
    guests: [
      ["VIJYA JAMNADAS RATHI", 78, "9867137222", "female"],
      ["VIRMATI VAGHJI RATHI", 73, "9699972001", "female"],
      ["NAVAL PADAMSHI RATHI", 70, "9920092884", "male"],
      ["CHHAYA MANILAL RATHI", 65, "9004326187", "female"],
      ["GODAVRIBEN BHEDAKIYA", 84, null, "female"],
    ],
  },
  {
    pothi: 63,
    guests: [
      ["LEENA KIRAN RATHI", 56, "9920092022", "female"],
      ["TEJAL ROHAN RATHI", 38, "9930940166", "female"],
      ["ISHITTA YASH RATHI", 35, "9869988899", "female"],
      ["DRASHTI KIRAN RATHI", 27, "8286859994", "female"],
      ["MANSI MANILAL RATHI", 32, "9920328661", "female"],
    ],
  },
  {
    pothi: 64,
    guests: [
      ["PARSHHOTAM VALLABHDAS RATHI", 70, "9822619150", "male"],
      ["MAHENDRA VALLABHDAS RATHI", 68, "9822394128", "male"],
      ["VRAJAL VALLABHDAS RATHI", 66, "9987332628", "male"],
      ["SANJAY VALLABHDAS RATHI", 62, "9987332638", "male"],
      ["BIMAL VALLBHDAS RATHI", 59, "9821238801", "male"],
    ],
  },
  {
    pothi: 65,
    guests: [
      ["RAJESHRI PARSHHOTAM RATHI", 66, "9820042003", "female"],
      ["ARUNA MAHENDRA RATHI", 63, "8830743566", "female"],
      ["KALAPNA VRAJLAL RATHI", 63, "9867019788", "female"],
      ["MANJULA SANJAY RATHI", 59, "9987097068", "female"],
      ["PRAGATI BIMAL RATHI", 57, "9892411489", "female"],
    ],
  },
];

const fail = (label, error) => {
  if (error) throw new Error(`${label}: ${error.message}`);
};

const created = { families: [], pothis: [], members: [], allocations: [], room: null };

try {
  const { data: existing, error: existingError } = await supabase
    .from("families")
    .select("id,pothi_id,head_name")
    .in("pothi_id", groups.map((group) => group.pothi));
  fail("checking existing families", existingError);
  if (existing?.length) {
    throw new Error(`Refusing to overwrite existing registrations: ${existing.map((row) => `${row.pothi_id} (${row.head_name})`).join(", ")}`);
  }

  const { data: pothiRooms, error: pothiRoomError } = await supabase
    .from("rooms")
    .select("id,room_number,venue_name,section_name,capacity,linked_pothi_id,room_type,owner_type")
    .eq("room_type", "pothi_room")
    .in("linked_pothi_id", [62, 63, 64, 65]);
  fail("loading existing pothi rooms", pothiRoomError);

  const roomByPothi = new Map((pothiRooms ?? []).map((room) => [room.linked_pothi_id, room]));
  const { data: candidates, error: candidateError } = await supabase
    .from("rooms")
    .select("id,room_number,venue_name,section_name,capacity,linked_pothi_id,room_type,owner_type,sort_order")
    .eq("owner_type", "SAMAJ")
    .is("linked_pothi_id", null)
    .gte("capacity", 5)
    .order("sort_order", { ascending: true });
  fail("loading unlinked Samaj rooms", candidateError);

  let selectedRoom = null;
  for (const room of candidates ?? []) {
    const { count, error } = await supabase
      .from("room_allocations")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id);
    fail(`checking occupancy for room ${room.room_number}`, error);
    if ((count ?? 0) === 0) {
      selectedRoom = room;
      break;
    }
  }
  if (!selectedRoom) throw new Error("No empty unlinked Samaj room with capacity 5+ was found for pothi 61");

  const { data: linkedRoom, error: linkError } = await supabase
    .from("rooms")
    .update({ linked_pothi_id: 61, room_type: "pothi_room", allotment_note: "Imported from BHAGVAT SAPTAH.xlsx" })
    .eq("id", selectedRoom.id)
    .is("linked_pothi_id", null)
    .select("id,room_number,venue_name,section_name,capacity")
    .single();
  fail("linking room to pothi 61", linkError);
  if (!linkedRoom) throw new Error("Room 61 link was not confirmed");
  created.room = linkedRoom;
  roomByPothi.set(61, linkedRoom);

  for (const group of groups) {
    const room = roomByPothi.get(group.pothi);
    if (!room) throw new Error(`No pothi room found for pothi ${group.pothi}`);
    if (Number(room.capacity) < group.guests.length) throw new Error(`Room ${room.room_number} cannot hold pothi ${group.pothi}`);

    const head = group.guests[0];
    const { data: family, error: familyError } = await supabase
      .from("families")
      .insert({
        head_name: head[0],
        head_mobile: head[2],
        city: "Imported guest list",
        address: "Imported from BHAGVAT SAPTAH.xlsx",
        wants_stay: true,
        pothi_id: group.pothi,
        registration_type: "pothi_room",
        stay_from: stayFrom,
        stay_to: stayTo,
      })
      .select("id,pothi_id,head_name,head_mobile")
      .single();
    fail(`creating family for pothi ${group.pothi}`, familyError);
    created.families.push(family);

    const { error: pothiError } = await supabase.from("pothis").update({ family_id: family.id }).eq("id", group.pothi).is("family_id", null);
    fail(`linking pothi ${group.pothi}`, pothiError);
    created.pothis.push(group.pothi);

    const { data: members, error: memberError } = await supabase
      .from("members")
      .insert(group.guests.map((guest, index) => ({ family_id: family.id, name: guest[0], age: guest[1], mobile: guest[2], gender: guest[3], is_head: index === 0 })))
      .select("id,name,family_id");
    fail(`creating members for pothi ${group.pothi}`, memberError);
    created.members.push(...members);

    const { data: allocations, error: allocationError } = await supabase
      .from("room_allocations")
      .insert(members.map((member) => ({ room_id: room.id, member_id: member.id, family_id: family.id })))
      .select("id,room_id,member_id,family_id");
    fail(`allocating room ${room.room_number}`, allocationError);
    created.allocations.push(...allocations);
    console.log(`Pothi ${group.pothi}: ${members.length} guests -> ${room.venue_name} / room ${room.room_number}`);
  }

  console.log(`Pothi 61 used ${created.room.venue_name} / room ${created.room.room_number}`);
  console.log("Imported 5 pothi families, 25 members, and 25 room allocations.");
} catch (error) {
  console.error(error.message);
  console.error("No automatic rollback was attempted; inspect the database before rerunning.");
  process.exitCode = 1;
}
