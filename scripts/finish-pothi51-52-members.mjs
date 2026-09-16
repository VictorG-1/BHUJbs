import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const readEnv = (key) => {
  const line = fs.readFileSync(".env.local", "utf8").split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  if (!line) throw new Error(`Missing ${key}`);
  return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
};
const supabase = createClient(readEnv("SUPABASE_URL"), readEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const groups = [
  { pothi: 51, head: "Hemlata Murji Navdhare", mobile: "9724157525", room: "48818511-64b6-49b1-8775-fea6b90f4a7e", guests: [
    ["Parshotam Mudji Bhedakiya", 75, "male", "8779577075"], ["Vasanta Parshotam Bhedakiya", 73, "female", "8779577075"], ["Pradeep Mudji Bhedakiya", 65, "male", "9664234184"], ["Surekha Pradeep Bhedakiya", 63, "female", "9664234184"], ["Naresh Lalji Gilda", 51, "male", "8080554545"] ] },
  { pothi: 52, head: "Niki Rohit Navdhare", mobile: "8849675425", room: "43668f7b-9190-4d85-adee-c0f920b68049", guests: [
    ["Bhupendra Kantilal Mandan", 68, "male", "9773243827"], ["Gunjan Bhupendra Mandan", 40, "female", "9825448052"], ["Hetal Gunjan Mandan", 40, "female", "9773158132"], ["Bhavna Mehul Mundada", 45, "female", "7984878843"], ["Mehul Mundada", 45, "male", "9374695952"] ] },
];
const fail = (label, error) => { if (error) throw new Error(`${label}: ${error.message}`); };
for (const group of groups) {
  const { data: existing, error: familyLoadError } = await supabase.from("families").select("id,head_mobile").eq("pothi_id", group.pothi).maybeSingle();
  fail(`loading Pothi ${group.pothi}`, familyLoadError);
  let family = existing;
  if (!family) {
    const { data, error } = await supabase.from("families").insert({ head_name: group.head, head_mobile: group.mobile, city: "Bhuj", address: `Imported Pothi ${group.pothi} guest details`, wants_stay: true, pothi_id: group.pothi, registration_type: "pothi_room", stay_from: "2026-11-13", stay_to: "2026-11-20" }).select("id").single();
    fail(`creating Pothi ${group.pothi} family`, error); family = data;
    const { error: linkError } = await supabase.from("pothis").update({ family_id: family.id }).eq("id", group.pothi).is("family_id", null);
    fail(`linking Pothi ${group.pothi}`, linkError);
  }
  const { data: members, error: memberLoadError } = await supabase.from("members").select("id,name").eq("family_id", family.id).order("created_at");
  fail(`loading Pothi ${group.pothi} members`, memberLoadError);
  const memberByName = new Map(members.map((member) => [member.name, member]));
  for (let index = 0; index < group.guests.length; index += 1) {
    const [name, age, gender, mobile] = group.guests[index];
    const existingMember = memberByName.get(name);
    let member = existingMember;
    if (!member) {
      const { data, error } = await supabase.from("members").insert({ family_id: family.id, name, age, gender, mobile, is_head: index === 0 }).select("id,name").single();
      fail(`creating ${name}`, error); member = data;
    } else {
      const { error } = await supabase.from("members").update({ age, gender, mobile, is_head: index === 0 }).eq("id", member.id);
      fail(`updating ${name}`, error);
    }
    const { data: allocation, error: allocationLoadError } = await supabase.from("room_allocations").select("id").eq("member_id", member.id).maybeSingle();
    fail(`checking allocation for ${name}`, allocationLoadError);
    if (allocation) { const { error } = await supabase.from("room_allocations").update({ room_id: group.room, family_id: family.id }).eq("id", allocation.id); fail(`updating allocation for ${name}`, error); }
    else { const { error } = await supabase.from("room_allocations").insert({ room_id: group.room, member_id: member.id, family_id: family.id }); fail(`allocating ${name}`, error); }
  }
  console.log(`Pothi ${group.pothi} updated: ${group.guests.length} members -> room ${group.room}`);
}
