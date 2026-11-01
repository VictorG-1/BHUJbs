import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

function env(key) {
  const line = fs.readFileSync(".env.local", "utf8").split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  if (!line) throw new Error(`Missing ${key}`);
  return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

async function fetchAll(table, columns) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    all.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return all;
}

const rooms = await fetchAll("rooms", "id, room_number, capacity");
const members = await fetchAll("members", "id, name, age, gender, mobile, family_id, is_head");
const families = await fetchAll("families", "id, head_name, registration_code, pothi_id, city");
const allocs = await fetchAll("room_allocations", "id, member_id, family_id, room_id");
const fam = Object.fromEntries(families.map((family) => [family.id, family]));
const allocByMember = Object.fromEntries(allocs.map((row) => [row.member_id, row]));
const roomById = Object.fromEntries(rooms.map((room) => [room.id, room]));

function occ(label) {
  const room = rooms.find((row) => row.room_number.includes(label) || row.room_number.endsWith(label));
  if (!room) return { room: label, people: [] };
  const people = allocs
    .filter((row) => row.room_id === room.id)
    .map((row) => {
      const member = members.find((item) => item.id === row.member_id);
      const family = fam[row.family_id];
      return `${member?.name} | ${family?.city} | ${family?.registration_code} | ${room.room_number}`;
    });
  return { room: room.room_number, id: room.id, people };
}

console.log(JSON.stringify({
  nav106: occ("NAVNEET COMPLEX / 106"),
  jak1106: occ("JAKHIBAI COMPLEX / 1106"),
  jak1113: occ("JAKHIBAI COMPLEX / 1113"),
  jak1114: occ("JAKHIBAI COMPLEX / 1114"),
  ratanben: occ("RATANBEN HALL"),
  champaben: members.filter((m) => /champaben/i.test(m.name)).map((m) => ({ name: m.name, city: fam[m.family_id]?.city, code: fam[m.family_id]?.registration_code, room: roomById[allocByMember[m.id]?.room_id]?.room_number, id: m.id, family_id: m.family_id })),
  anils: members.filter((m) => /^anil\b/i.test(m.name) && /bhutada/i.test(m.name)).map((m) => ({ name: m.name, city: fam[m.family_id]?.city, code: fam[m.family_id]?.registration_code, room: roomById[allocByMember[m.id]?.room_id]?.room_number, id: m.id, family_id: m.family_id })),
  harish: members.filter((m) => /harish/i.test(m.name)).map((m) => ({ name: m.name, city: fam[m.family_id]?.city, code: fam[m.family_id]?.registration_code, pothi: fam[m.family_id]?.pothi_id, room: roomById[allocByMember[m.id]?.room_id]?.room_number, id: m.id, family_id: m.family_id }))
}, null, 2));
