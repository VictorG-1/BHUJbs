import fs from "node:fs";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const WORKBOOK = "C:/Users/DELL/Downloads/Members_Room_Pothi_Wise.xlsx";

function env(key) {
  const line = fs.readFileSync(".env.local", "utf8").split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  if (!line) throw new Error(`Missing ${key}`);
  return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

function digits(value) {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\u0a80-\u0aff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function exactName(a, b) {
  return Boolean(normalizeName(a) && normalizeName(a) === normalizeName(b));
}

async function fetchAll(db, table, columns) {
  const all = [];
  for (let from = 0; from < 20000; from += 400) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 399);
    if (error) throw error;
    const page = data ?? [];
    if (!page.length) break;
    all.push(...page);
    if (page.length < 400) break;
  }
  return all;
}

function parseExcel() {
  const workbook = XLSX.readFile(WORKBOOK);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Pothi-wise"], { defval: null });
  return rows.map((row) => {
    const pothiRaw = String(row.Pothi ?? "").trim();
    const pothi = Number(pothiRaw);
    return {
      name: String(row["Member Name"] ?? "").trim(),
      mobile: digits(row["Member Mobile"]),
      code: String(row["Registration Code"] ?? "").trim().toUpperCase(),
      pothi: Number.isInteger(pothi) && pothi >= 1 && pothi <= 74 ? pothi : null,
      pothiRaw
    };
  }).filter((row) => row.name && row.pothi);
}

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const excelRows = parseExcel();
const families = await fetchAll(db, "families", "id, head_name, head_mobile, city, registration_code, registration_type, pothi_id, reference_pothi_id");
const pothis = await fetchAll(db, "pothis", "id, family_id");
const members = await fetchAll(db, "members", "id, name, mobile, family_id, is_head");
const allocations = await fetchAll(db, "room_allocations", "id, member_id, family_id, room_id");

const familyById = new Map(families.map((family) => [family.id, family]));
const pothiFamilyId = new Map(pothis.filter((pothi) => pothi.family_id).map((pothi) => [pothi.id, pothi.family_id]));
const membersByFamily = new Map();
for (const member of members) {
  const list = membersByFamily.get(member.family_id) ?? [];
  list.push(member);
  membersByFamily.set(member.family_id, list);
}
const allocByMember = new Map();
for (const row of allocations) {
  const list = allocByMember.get(row.member_id) ?? [];
  list.push(row);
  allocByMember.set(row.member_id, list);
}

function sameRoom(leftId, rightId) {
  if (!leftId || !rightId) return false;
  const left = (allocByMember.get(leftId) ?? []).map((row) => row.room_id);
  const right = (allocByMember.get(rightId) ?? []).map((row) => row.room_id);
  return left.some((roomId) => right.includes(roomId));
}

function samePerson(entry, member, keep) {
  if (!exactName(entry.name, member.name)) return false;
  const extraMobile = digits(member.mobile);
  const keepMobile = digits(keep?.mobile) || entry.mobile;
  if (keep && sameRoom(keep.id, member.id)) return true;
  if (extraMobile.length === 10 && keepMobile.length === 10) return extraMobile === keepMobile;
  return extraMobile.length !== 10;
}

const usedExtras = new Set();
const drops = [];
const attaches = [];
const skippedHead = [];
const skippedDifferentMobile = [];

for (const entry of excelRows) {
  const pothiFamily = familyById.get(pothiFamilyId.get(entry.pothi));
  if (!pothiFamily) continue;
  const pothiMembers = membersByFamily.get(pothiFamily.id) ?? [];
  const keep = pothiMembers.find((member) => exactName(entry.name, member.name) && (
    !entry.mobile || !digits(member.mobile) || entry.mobile === digits(member.mobile)
  ));
  const extras = members.filter((member) => {
    if (member.family_id === pothiFamily.id) return false;
    if (usedExtras.has(member.id)) return false;
    const family = familyById.get(member.family_id);
    if (family?.registration_type !== "general_room") return false;
    return samePerson(entry, member, keep);
  });

  for (const extra of extras) {
    if (extra.is_head && extra.family_id === pothiFamily.id) continue;
    const extraFamily = familyById.get(extra.family_id);
    if (extra.is_head && extraFamily?.registration_type === "pothi_room") {
      skippedHead.push({ entry, extra });
      continue;
    }
    usedExtras.add(extra.id);
    if (keep) {
      drops.push({ entry, keep, extra, extraFamily });
    } else {
      attaches.push({ entry, extra, extraFamily, pothiFamily });
    }
  }
}

console.log(JSON.stringify({
  apply: APPLY,
  excelPothiRows: excelRows.length,
  dropGeneralCopies: drops.length,
  attachGeneralToPothi: attaches.length,
  skippedHead: skippedHead.length,
  skippedDifferentMobile: skippedDifferentMobile.length,
  dropSample: drops.slice(0, 40).map((item) => ({
    name: item.entry.name,
    pothi: item.entry.pothi,
    keepId: item.keep.id,
    extraId: item.extra.id,
    extraHead: item.extra.is_head,
    extraCode: item.extraFamily?.registration_code,
    extraFamily: item.extraFamily?.head_name
  })),
  attachSample: attaches.slice(0, 40).map((item) => ({
    name: item.entry.name,
    pothi: item.entry.pothi,
    extraId: item.extra.id,
    extraHead: item.extra.is_head,
    extraCode: item.extraFamily?.registration_code,
    extraFamily: item.extraFamily?.head_name
  }))
}, null, 2));

if (!APPLY) process.exit(0);

async function setAllocationFamily(memberId, familyId) {
  const existing = allocByMember.get(memberId) ?? [];
  for (const row of existing) {
    const { error } = await db.from("room_allocations").update({ family_id: familyId }).eq("id", row.id);
    if (error) throw error;
  }
}

async function maybePromoteHead(familyId, exceptMemberId) {
  const remaining = (membersByFamily.get(familyId) ?? []).filter((member) => member.id !== exceptMemberId);
  membersByFamily.set(familyId, remaining);
  if (!remaining.length) return;
  if (remaining.some((member) => member.is_head)) return;
  const next = remaining[0];
  const { error } = await db.from("members").update({ is_head: true }).eq("id", next.id);
  if (error) throw error;
  next.is_head = true;
}

for (const item of drops) {
  if (item.extra.is_head) await maybePromoteHead(item.extra.family_id, item.extra.id);
  const { error: allocError } = await db.from("room_allocations").delete().eq("member_id", item.extra.id);
  if (allocError) throw allocError;
  const { error: memberError } = await db.from("members").delete().eq("id", item.extra.id);
  if (memberError) throw memberError;
}

for (const item of attaches) {
  if (item.extra.is_head) await maybePromoteHead(item.extra.family_id, item.extra.id);
  const { error } = await db.from("members").update({ family_id: item.pothiFamily.id, is_head: false }).eq("id", item.extra.id);
  if (error) throw error;
  await setAllocationFamily(item.extra.id, item.pothiFamily.id);
  item.extra.family_id = item.pothiFamily.id;
  item.extra.is_head = false;
  const list = membersByFamily.get(item.pothiFamily.id) ?? [];
  list.push(item.extra);
  membersByFamily.set(item.pothiFamily.id, list);
}

const touchedFamilies = [...new Set([...drops, ...attaches].map((item) => item.extraFamily?.id).filter(Boolean))];
let deletedEmpty = 0;
for (const familyId of touchedFamilies) {
  const { count, error } = await db.from("members").select("id", { count: "exact", head: true }).eq("family_id", familyId);
  if (error) throw error;
  if (count) continue;
  const family = familyById.get(familyId);
  if (family?.registration_type === "pothi_room" || family?.pothi_id) continue;
  const { error: allocError } = await db.from("room_allocations").delete().eq("family_id", familyId);
  if (allocError) throw allocError;
  const { error: delError } = await db.from("families").delete().eq("id", familyId);
  if (delError) throw delError;
  deletedEmpty += 1;
}

console.log(JSON.stringify({ appliedDrops: drops.length, appliedAttaches: attaches.length, deletedEmptyFamilies: deletedEmpty }, null, 2));
