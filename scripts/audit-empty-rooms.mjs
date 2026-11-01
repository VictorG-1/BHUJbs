import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function env(key) {
  const line = fs.readFileSync(".env.local", "utf8").split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  if (!line) throw new Error(`Missing ${key}`);
  return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

async function all(table, cols) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

const rooms = await all("rooms", "id, room_number, venue_name, section_name, source_room_number, floor, capacity, owner_type, room_type, linked_pothi_id, allotment_note");
const allocs = await all("room_allocations", "id, room_id, member_id, family_id");
const members = await all("members", "id, name, family_id");
const families = await all("families", "id, pothi_id, wants_stay, head_name, registration_type");

const allocCount = new Map();
const unknownRooms = [];
for (const row of allocs) {
  allocCount.set(row.room_id, (allocCount.get(row.room_id) || 0) + 1);
  if (!rooms.some((room) => room.id === row.room_id)) unknownRooms.push(row.room_id);
}

const familyById = new Map(families.map((family) => [family.id, family]));
const pothiMembers = new Map();
for (const member of members) {
  const pothi = familyById.get(member.family_id)?.pothi_id;
  if (!pothi) continue;
  const list = pothiMembers.get(pothi) ?? [];
  list.push(member);
  pothiMembers.set(pothi, list);
}

const emptyByAlloc = rooms.filter((room) => (allocCount.get(room.id) || 0) === 0);
const emptyIgnoringPothiLink = emptyByAlloc.filter((room) => !room.linked_pothi_id);
const emptyAvailable = emptyByAlloc.filter((room) => !room.linked_pothi_id && room.room_type === "general_room" && !String(room.section_name).toLowerCase().includes("pending"));

const emptyButPothiHasPeople = emptyByAlloc.filter((room) => room.linked_pothi_id && (pothiMembers.get(room.linked_pothi_id) || []).length);
const occupiedPartial = rooms.filter((room) => {
  const used = allocCount.get(room.id) || 0;
  return used > 0 && used < (room.capacity || 0);
});

console.log(JSON.stringify({
  rooms: rooms.length,
  allocations: allocs.length,
  uniqueAllocatedRooms: allocCount.size,
  unknownAllocRoomIds: [...new Set(unknownRooms)].length,
  emptyByAlloc: emptyByAlloc.length,
  emptyNoPothiLink: emptyIgnoringPothiLink.length,
  emptyGeneralNoPothi: emptyAvailable.length,
  emptyPothiRoomsWithFamilyMembers: emptyButPothiHasPeople.length,
  partialRooms: occupiedPartial.length,
  leftoverBedsOnPartial: occupiedPartial.reduce((sum, room) => sum + Math.max(0, (room.capacity || 0) - (allocCount.get(room.id) || 0)), 0)
}, null, 2));

console.log("\nEMPTY but pothi family exists:");
for (const room of emptyButPothiHasPeople) {
  const people = pothiMembers.get(room.linked_pothi_id) || [];
  console.log(` pothi ${room.linked_pothi_id} ${people.length} members | ${room.room_number} | ${room.allotment_note || ""}`);
}

function shortVenue(room) {
  const section = String(room.section_name || "").toUpperCase();
  const venue = String(room.venue_name || "").toUpperCase();
  const source = String(room.source_room_number || "");
  const haystack = section + venue;
  if (haystack.includes("JAKHIBAI")) return "JAKHIBAI";
  if (haystack.includes("MARU")) return "MARU";
  if (haystack.includes("PAN VALLABH") || haystack.includes("PANVALLABH")) return "PANVALLABH";
  if (haystack.includes("VALIB")) return "VALIBAI";
  if (haystack.includes("RATANBEN")) return "RATANBEN";
  if (haystack.includes("ZAVER")) return "ZAVERBEN";
  if (haystack.includes("NAVNEET") && source.toUpperCase() === "HALL") return "NAVNEET HALL";
  if (haystack.includes("NAVNEET")) return "NAVNEET";
  if ((haystack.includes("SPM") || haystack.includes("S.P.M")) && source.toUpperCase() === "HALL") return "SPM HALL";
  if (haystack.includes("SPM") || haystack.includes("S.P.M")) return "SPM";
  if (haystack.includes("BHUJ VIEW") || haystack.includes("BHUJVIEW")) return "BHUJVIEW";
  if (haystack.includes("SMRUTI")) return "SMRUTI";
  if (haystack.includes("ATITHI")) return "ATITHI";
  if (haystack.includes("RAJGOR")) return "RAJGOR";
  if (haystack.includes("V.S.C") || haystack.includes("VSC")) return "VSC";
  if (haystack.includes("V.B.C") || haystack.includes("VBC") || haystack.includes("VAGAD")) return "VBC";
  if (haystack.includes("PRIVATE HOTEL")) return "PRIVATE HOTEL";
  return room.section_name || room.venue_name;
}

function shortRoom(room) {
  const venue = shortVenue(room);
  const source = String(room.source_room_number || "");
  const floor = String(room.floor || "").replace(/\./g, "").replace(/\s/g, "");
  if (!source || source.toUpperCase() === "HALL" || source.toUpperCase() === "PRIVATE") return floor ? `${venue} ${floor}` : venue;
  if (["JAKHIBAI", "NAVNEET", "BHUJVIEW", "SMRUTI"].includes(venue)) return `${source}/${venue}`;
  return `${venue}/${source}`;
}

const pothiHasFamily = new Set(families.map((family) => family.pothi_id).filter(Boolean));
const vacant = emptyByAlloc.filter((room) => {
  if (String(room.section_name).toLowerCase().includes("pending")) return false;
  if (/store room/i.test(String(room.allotment_note || ""))) return false;
  if (room.linked_pothi_id && pothiHasFamily.has(room.linked_pothi_id)) return false;
  return true;
});

const rows = vacant
  .map((room) => ({
    venue: shortVenue(room),
    room: shortRoom(room),
    floor: room.floor || "",
    cap: room.capacity,
    type: room.room_type === "pothi_room" ? "Pothi" : room.room_type === "private_room" ? "Private" : "General",
    pothi: room.linked_pothi_id,
    note: room.allotment_note || "",
    owner: room.owner_type
  }))
  .sort((left, right) => left.venue.localeCompare(right.venue) || left.room.localeCompare(right.room, undefined, { numeric: true }));

const venues = {};
for (const row of rows) {
  venues[row.venue] ||= { rooms: 0, beds: 0 };
  venues[row.venue].rooms += 1;
  venues[row.venue].beds += row.cap || 0;
}

fs.writeFileSync("scripts/_empty-rooms.json", JSON.stringify({
  generated: new Date().toISOString(),
  totalRooms: rooms.length,
  occupied: rooms.length - emptyByAlloc.length,
  wronglyListedAsEmpty: emptyButPothiHasPeople.length,
  empty: rows.length,
  emptyBeds: rows.reduce((sum, row) => sum + (row.cap || 0), 0),
  venues,
  rows
}, null, 2));

console.log("vacant available", rows.length, "beds", rows.reduce((sum, row) => sum + (row.cap || 0), 0));
console.log(JSON.stringify(venues, null, 2));
