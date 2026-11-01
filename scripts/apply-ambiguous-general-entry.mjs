import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

function env(key) {
  const line = fs.readFileSync(".env.local", "utf8").split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  if (!line) throw new Error(`Missing ${key}`);
  return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

async function roomByNumber(roomNumber) {
  const { data, error } = await db.from("rooms").select("id, room_number").eq("room_number", roomNumber).single();
  if (error) throw error;
  return data;
}

async function allocate(memberId, familyId, roomId) {
  const { data: existing, error: existingError } = await db.from("room_allocations").select("id, room_id").eq("member_id", memberId);
  if (existingError) throw existingError;
  if (existing?.[0]?.room_id === roomId) return "already";
  if (existing?.[0]) {
    const { error } = await db.from("room_allocations").update({ room_id: roomId, family_id: familyId }).eq("id", existing[0].id);
    if (error) throw error;
    return "moved";
  }
  const { error } = await db.from("room_allocations").insert({ member_id: memberId, family_id: familyId, room_id: roomId });
  if (error) throw error;
  return "inserted";
}

const ratanben = await roomByNumber("YAX MANDIR / RATANBEN HALL / HALL / F.F.");
const nav106 = await roomByNumber("YAX MANDIR / NAVNEET COMPLEX / 106");
const jak1106 = await roomByNumber("YAX MANDIR / JAKHIBAI COMPLEX / 1106");
const jak1113 = await roomByNumber("YAX MANDIR / JAKHIBAI COMPLEX / 1113");
const jak1114 = await roomByNumber("YAX MANDIR / JAKHIBAI COMPLEX / 1114");

const actions = [
  { name: "Champaben Hirjibhai Sharda", room: nav106, why: "Excel Champaben Hirji Sharda + Mehsana/Dayapar group already in 106" },
  { name: "Daksha Alkesh Shah", room: ratanben, why: "Excel Daksha A Shah, female, Ratanben; A = Alkesh" },
  { name: "Bharti Chandrakant Bhutada", room: ratanben, why: "Excel Bharti Shantilal Bhutada, same first/last, 61AB Ratanben list" },
  { name: "Manjula Purshottam Navdhare", room: ratanben, why: "Excel Manjula P Navdhare; P = Purshottam, not parsonage in 908" },
  { name: "Harshaben Dayalal Navdhare", room: ratanben, why: "Excel Harsha G Navdhare; only unallocated Harsha Navdhare on 61AB list" },
  { name: "Usha Praful Shah", room: ratanben, why: "Excel Ushaben Shah, female, Ratanben; Bharatbhai Ushaben already in Navneet 15" },
  { name: "Anil Mulji Bhutada", room: jak1106, why: "Excel Anil Bhutada Ahmedabad/1106 with son Pratham already in 1106" }
];

const report = [];

for (const action of actions) {
  const { data: member, error } = await db.from("members").select("id, name, family_id").eq("name", action.name).maybeSingle();
  if (error) throw error;
  if (!member) {
    report.push({ name: action.name, status: "missing" });
    continue;
  }
  const status = await allocate(member.id, member.family_id, action.room.id);
  await db.from("families").update({ wants_stay: true }).eq("id", member.family_id);
  report.push({ excelMatch: action.why, keep: member.name, to: action.room.room_number, status });
}

const { data: harish } = await db.from("members").select("id, name, family_id, families(city)").eq("id", "126d2498-2e8b-42c0-ab89-51056008e72e").single();
const harishStatus = await allocate(harish.id, harish.family_id, jak1114.id);
await db.from("families").update({ wants_stay: true }).eq("id", harish.family_id);
report.push({
  excelMatch: "Excel Harish Bhutada, city Jamnagar, 1114; matched Harishkumar Shah of Jamnagar after surname change",
  keep: harish.name,
  to: jak1114.room_number,
  status: harishStatus
});

const { data: rekhaFamily } = await db.from("families").select("id, head_name, registration_code").eq("registration_code", "FC2DFA6DF3").single();
const { data: existingRekha } = await db.from("members").select("id, name").ilike("name", "REKHABEN ANIL BHUTADA").maybeSingle();
let rekha = existingRekha;
if (!rekha) {
  const { data: created, error } = await db.from("members").insert({
    family_id: rekhaFamily.id,
    name: "REKHABEN ANIL BHUTADA",
    gender: "female",
    age: 0,
    is_head: false
  }).select("id, name").single();
  if (error) throw error;
  rekha = created;
}
const rekhaStatus = await allocate(rekha.id, rekhaFamily.id, jak1113.id);
report.push({ excelMatch: "Excel Rekhaben Anil Bhutada, Jamnagar, 1113 with Sarlaben Harish Shah", keep: rekha.name, to: jak1113.room_number, status: rekhaStatus });

const { data: existingAnilJ } = await db.from("members").select("id, name, family_id").eq("name", "ANIL BHUTADA").eq("family_id", harish.family_id).maybeSingle();
let anilJ = existingAnilJ;
if (!anilJ) {
  const { data: created, error } = await db.from("members").insert({
    family_id: harish.family_id,
    name: "ANIL BHUTADA",
    gender: "male",
    age: 0,
    is_head: false
  }).select("id, name, family_id").single();
  if (error) throw error;
  anilJ = created;
}
const anilJStatus = await allocate(anilJ.id, anilJ.family_id, jak1114.id);
report.push({ excelMatch: "Excel second Anil Bhutada, Jamnagar, 1114 with Harish", keep: anilJ.name, to: jak1114.room_number, status: anilJStatus });

console.log(JSON.stringify(report, null, 2));
