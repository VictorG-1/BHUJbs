import fs from "node:fs";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const WORKBOOK = "C:/Users/DELL/Desktop/BHAGWAT/GENERAL ENTRY.xlsx";

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

function tokensOf(value) {
  return normalizeName(value).split(" ").filter((part) => part.length > 1);
}

const TOKEN_ALIASES = new Map([
  ["sheth", "seth"],
  ["seth", "seth"],
  ["gagdani", "gagdani"],
  ["gagadani", "gagdani"],
  ["gingal", "gingal"],
  ["ginghal", "gingal"],
  ["mandam", "mandan"],
  ["mandan", "mandan"],
  ["gurvanti", "gunwanti"],
  ["gunwanti", "gunwanti"],
  ["kamla", "kamla"],
  ["kamda", "kamla"],
  ["himmatlal", "himatlal"],
  ["himatlal", "himatlal"]
]);

function stemToken(value) {
  const raw = String(value ?? "");
  return TOKEN_ALIASES.get(raw) || raw.replace(/(ben|bhai|ji)$/g, "");
}

function closeToken(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const a = stemToken(left);
  const b = stemToken(right);
  if (a && b && a === b) return true;
  if (left.length >= 5 && right.length >= 5 && (left.startsWith(right) || right.startsWith(left))) return true;
  if (left.slice(1) === right.slice(1) && left.length >= 6) return true;
  const squeeze = (value) => value.replace(/[aeiou]/g, "");
  if (left.length >= 6 && right.length >= 6 && squeeze(a) && squeeze(a) === squeeze(b)) return true;
  return false;
}

function firstLastClose(a, b) {
  const left = tokensOf(a);
  const right = tokensOf(b);
  if (!left.length || !right.length) return false;
  return closeToken(left[0], right[0]) && closeToken(left.at(-1), right.at(-1));
}

function nameScore(a, b) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = tokensOf(left);
  const rightTokens = tokensOf(right);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const firstClose = closeToken(leftTokens[0], rightTokens[0]);
  const lastClose = closeToken(leftTokens.at(-1), rightTokens.at(-1));
  if (firstClose && lastClose && (leftTokens.length > 1 || rightTokens.length > 1)) return 0.95;
  if (firstClose && lastClose) return 0.9;
  if (firstClose && leftTokens.length === 1) return 0.72;
  const overlap = rightTokens.filter((part) => leftTokens.some((token) => closeToken(token, part))).length;
  if (!overlap) return 0;
  return (overlap / Math.max(leftTokens.length, rightTokens.length)) * 0.8;
}

function compact(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function parseExcel() {
  const workbook = XLSX.readFile(WORKBOOK);
  const rows = [];
  for (const sheet of workbook.SheetNames) {
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, defval: null }).slice(1);
    for (const row of data) {
      const name = String(row[0] ?? "").trim();
      const room = String(row[8] ?? "").trim();
      if (!name) continue;
      rows.push({
        sheet,
        name,
        age: row[1] == null || row[1] === "" ? null : Number(row[1]),
        gender: String(row[2] ?? "").toLowerCase(),
        mobile: digits(row[3]),
        arrival: excelDate(row[4]),
        departure: excelDate(row[5]),
        code: String(row[6] ?? "").trim().toUpperCase(),
        city: String(row[7] ?? "").trim(),
        roomLabel: room
      });
    }
  }
  return rows;
}

function sectionHint(label) {
  const text = compact(label);
  if (text.includes("JAKH")) return "JAKHIBAI";
  if (text.includes("MARU")) return "MARU COMPLEX";
  if (text.includes("NAVNEETHALL") || (text.includes("NAVNEET") && text.includes("HALL"))) return "NAVNEET HALL";
  if (text.includes("NAVNEET")) return "NAVNEET COMPLEX";
  if (text.includes("BHUJVIEW") || text.includes("BHUJVIEWHOTEL")) return "BHUJ VIEW HOTEL";
  if (text.includes("SMRUTI")) return "SMRUTI HILLS HOTEL";
  if (text.includes("ATITHI")) return "ATITHI HOTEL";
  if (text.includes("VALIB")) return "VALIBEN HALL";
  if (text.includes("RATANBEN")) return "RATANBEN HALL";
  if (text.includes("ZAVER") || text.includes("JAVER")) return "ZAVERBEN HALL";
  if (text.includes("VSC") || text.includes("V.S.C")) return "V.S.C";
  if (text.includes("VBC") || text.includes("VAGAD")) return "VAGAD";
  if (text.includes("PRIVATEHOTEL")) return "PRIVATE HOTEL";
  if (text === "SPMCOMPLEXHALL" || text === "SPMHALL" || text === "SPMCOMPLEX") return "SPM_HALL";
  if (text.includes("SPM") || text.includes("S.P.M")) return "S.P.M.COMPLEX";
  if (text.includes("RAJGOR")) return "RAJGOR";
  if (text.includes("PANVALLABH")) return "PANVALLABH";
  return null;
}

function resolveRoom(label, rooms) {
  const raw = String(label ?? "").trim();
  if (!raw) return { status: "blank", room: null };
  const upper = raw.toUpperCase().replace(/\s+/g, " ").trim();
  if (upper === "PENDING") return { status: "pending", room: null };
  if (upper === "PRIVATE HOTEL") {
    const privateHotel = rooms.find((room) => compact(room.section_name) === "PRIVATEHOTEL" || compact(room.room_number) === "HOTELPRIVATEHOTEL");
    return privateHotel ? { status: "ok", room: privateHotel } : { status: "unmapped", room: null };
  }

  let source = null;
  let hint = sectionHint(upper);
  let floor = null;
  if (/\bG\.?F\.?\b|GROUND/.test(upper)) floor = "GF";
  else if (/\bF\.?F\.?\b|FIRST/.test(upper)) floor = "FF";
  else if (/\bS\.?F\.?\b|SECOND/.test(upper)) floor = "SF";
  const numberedA = upper.match(/^(\d+)\s*\/\s*(.+)$/);
  const numberedB = upper.match(/^([A-Z. ]+)\s*\/\s*(\d+)$/);
  if (numberedA) {
    source = numberedA[1];
    hint = sectionHint(numberedA[2]) || hint;
  } else if (numberedB) {
    source = numberedB[2];
    hint = sectionHint(numberedB[1]) || hint;
  } else if (/HALL|VALIBAI|SPM COMPLEX/i.test(upper)) {
    source = "HALL";
    hint = sectionHint(upper) || hint;
  }

  if (hint === "SPM_HALL") {
    source = "HALL";
    hint = "S.P.M.COMPLEX";
  }

  const candidates = rooms.filter((room) => {
    const section = compact(room.section_name);
    const venue = compact(room.venue_name);
    const roomNo = compact(room.room_number);
    const matchesHint = !hint || section.includes(compact(hint)) || venue.includes(compact(hint)) || roomNo.includes(compact(hint));
    const matchesSource = !source || String(room.source_room_number) === String(source);
    const matchesFloor = !floor || compact(room.floor) === floor || roomNo.endsWith(floor);
    return matchesHint && matchesSource && matchesFloor;
  });

  if (candidates.length === 1) return { status: "ok", room: candidates[0] };
  if (source === "HALL") {
    const halls = candidates.filter((room) => String(room.source_room_number).toUpperCase() === "HALL");
    if (halls.length === 1) return { status: "ok", room: halls[0] };
    if (compact(upper) === "SPMCOMPLEX" || compact(upper) === "SPMCOMPLEXHALL" || compact(upper) === "SPMHALL") {
      const spmHall = halls.find((room) => compact(room.section_name).includes("SPM"));
      if (spmHall) return { status: "ok", room: spmHall };
    }
  }
  if (candidates.length > 1) return { status: "ambiguous", room: null, candidates: candidates.map((room) => room.room_number) };
  return { status: "unmapped", room: null };
}

async function fetchAll(db, table, columns) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    all.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return all;
}

function scoreMember(entry, member, family) {
  const exact = normalizeName(entry.name) === normalizeName(member.name);
  const firstLast = firstLastClose(entry.name, member.name);
  const name = nameScore(entry.name, member.name);
  const mobile = digits(member.mobile);
  const mobileMatch = Boolean(entry.mobile && mobile.length === 10 && entry.mobile === mobile);
  const codeMatch = Boolean(entry.code && family?.registration_code && entry.code === String(family.registration_code).toUpperCase());
  if (!exact && !firstLast && name < 0.9) return 0;
  let score = exact ? 1 : firstLast ? 0.95 : name;
  if (mobileMatch && (exact || firstLast)) score = Math.max(score, 0.98);
  if (codeMatch && (exact || firstLast)) score = Math.max(score, 0.99);
  if (entry.city && family?.city && compact(entry.city) === compact(family.city)) score += 0.01;
  return Math.min(score, 1);
}

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const excelRows = parseExcel();
const families = await fetchAll(db, "families", "id, head_name, head_mobile, city, registration_code, registration_type, pothi_id, wants_stay");
const members = await fetchAll(db, "members", "id, name, mobile, family_id, gender, age, is_head");
const rooms = await fetchAll(db, "rooms", "id, room_number, venue_name, section_name, source_room_number, floor, capacity, room_type, owner_type, linked_pothi_id");
const allocations = await fetchAll(db, "room_allocations", "id, member_id, family_id, room_id");

const familyById = new Map(families.map((family) => [family.id, family]));
const familiesByCode = new Map(families.map((family) => [String(family.registration_code ?? "").toUpperCase(), family]));
const membersByFamily = new Map();
for (const member of members) {
  const list = membersByFamily.get(member.family_id) ?? [];
  list.push(member);
  membersByFamily.set(member.family_id, list);
}
const allocationByMember = new Map(allocations.map((row) => [row.member_id, row]));
const allocationsByMember = new Map();
for (const row of allocations) {
  const list = allocationsByMember.get(row.member_id) ?? [];
  list.push(row);
  allocationsByMember.set(row.member_id, list);
}
const roomById = new Map(rooms.map((room) => [room.id, room]));

function pickBest(scored) {
  if (!scored.length) return { status: "none", picked: null };
  const exact = scored.filter((row) => normalizeName(row.member.name) === normalizeName(row.entryName ?? ""));
  const list = exact.length === 1 ? exact : scored;
  const picked = list[0];
  if (list[1] && picked.score - list[1].score < 0.04 && list[1].score >= 0.9) {
    return { status: "ambiguous", picked: null, options: list.slice(0, 3) };
  }
  return { status: "ok", picked };
}

function matchEntry(entry) {
  const family = entry.code ? familiesByCode.get(entry.code) : null;
  const annotate = (member) => ({
    member,
    family: familyById.get(member.family_id),
    score: scoreMember(entry, member, familyById.get(member.family_id)),
    entryName: entry.name
  });

  if (entry.code && !family) {
    return { status: "family_not_found", family: null, options: [] };
  }

  if (family) {
    const scored = (membersByFamily.get(family.id) ?? [])
      .map(annotate)
      .filter((row) => row.score >= 0.72)
      .sort((left, right) => right.score - left.score);
    const picked = pickBest(scored);
    if (picked.status === "ambiguous") return { status: "member_ambiguous", options: picked.options, family };
    if (picked.picked) return { status: "ok", ...picked.picked };
    return { status: "member_not_found", family, options: [] };
  }

  const scored = members.map(annotate).filter((row) => row.score >= 0.9).sort((a, b) => b.score - a.score);
  const exact = scored.filter((row) => normalizeName(row.member.name) === normalizeName(entry.name));
  const firstLast = scored.filter((row) => firstLastClose(entry.name, row.member.name));
  const byMobile = entry.mobile
    ? scored.filter((row) => digits(row.member.mobile) === entry.mobile && digits(row.member.mobile).length === 10)
    : [];

  const tryList = (list) => {
    const picked = pickBest(list);
    if (picked.status === "ambiguous") return { status: "member_ambiguous", options: picked.options, family: null };
    if (picked.picked) return { status: "ok", ...picked.picked };
    return null;
  };

  if (tokensOf(entry.name).length >= 2) {
    const uniqueFirstLast = tryList(firstLast);
    if (uniqueFirstLast) return uniqueFirstLast;
  }
  const uniqueExact = tryList(exact);
  if (uniqueExact) return uniqueExact;
  const uniqueMobile = tryList(byMobile);
  if (uniqueMobile) return uniqueMobile;

  return { status: "family_not_found", family: null, options: firstLast.slice(0, 3) };
}

function coreName(value) {
  return tokensOf(value).map(stemToken).filter(Boolean).join(" ");
}

function extraDuplicates(entry, keepId) {
  const extras = [];
  const entryMobile = entry.mobile;
  for (const member of members) {
    if (member.id === keepId) continue;
    const sameMobile = entryMobile && digits(member.mobile) === entryMobile && digits(member.mobile).length === 10;
    const exact = coreName(entry.name) === coreName(member.name);
    const entryTokens = tokensOf(entry.name).filter((part) => part.length > 1);
    const memberTokens = tokensOf(member.name).filter((part) => part.length > 1);
    const sameShape = Math.abs(entryTokens.length - memberTokens.length) <= 1;
    if (exact && sameShape && (sameMobile || !member.is_head)) extras.push(member);
  }
  return extras;
}

function excelDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 40000) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return date.toISOString().slice(0, 10);
  }
  return null;
}

const issues = [];
const planned = [];
const seenExcel = new Map();

for (const entry of excelRows) {
  const excelKey = `${entry.code}|${normalizeName(entry.name)}|${entry.mobile}|${entry.roomLabel}`;
  if (seenExcel.has(excelKey)) {
    issues.push({ type: "duplicate_excel_row", ...entry });
    continue;
  }
  seenExcel.set(excelKey, true);

  const resolved = resolveRoom(entry.roomLabel, rooms);
  const matched = matchEntry(entry);
  if (resolved.status !== "ok") {
    issues.push({ type: `room_${resolved.status}`, ...entry, candidates: resolved.candidates ?? [] });
    continue;
  }
  if (matched.status !== "ok") {
    issues.push({ type: matched.status, ...entry, options: (matched.options ?? []).map((row) => row.member?.name) });
    continue;
  }

  const existingList = allocationsByMember.get(matched.member.id) ?? [];
  const extras = extraDuplicates(entry, matched.member.id);
  planned.push({
    entry,
    member: matched.member,
    family: matched.family,
    room: resolved.room,
    existingList,
    extras,
    score: matched.score
  });
}

const usedMembers = new Set();
const inserts = [];
const updates = [];
const alreadyOk = [];
const extraAllocDeletes = [];
const extraMemberDeletes = [];

for (const item of planned) {
  if (usedMembers.has(item.member.id)) {
    issues.push({ type: "same_member_two_excel_rooms", ...item.entry, memberId: item.member.id, keepRoom: item.room.room_number });
    continue;
  }
  usedMembers.add(item.member.id);

  const currentPrimary = item.existingList[0] ?? null;
  const extraAllocs = item.existingList.slice(1);
  for (const extra of extraAllocs) extraAllocDeletes.push({ ...item, allocation: extra });

  for (const extraMember of item.extras) {
    if (usedMembers.has(extraMember.id) || planned.some((row) => row.member.id === extraMember.id)) continue;
    extraMemberDeletes.push({
      keep: item.member,
      extra: extraMember,
      extraFamily: familyById.get(extraMember.family_id),
      extraAllocs: allocationsByMember.get(extraMember.id) ?? [],
      entry: item.entry,
      room: item.room
    });
  }

  const exact = coreName(item.entry.name) === coreName(item.member.name);
  const coded = Boolean(item.entry.code);
  const mobileMatch = Boolean(item.entry.mobile && digits(item.member.mobile) === item.entry.mobile);
  const last = stemToken(tokensOf(item.member.name).at(-1) || "");
  const commonLast = new Set(["shah", "patel", "mall", "bhutada", "somani", "navdhare", "mandan", "rathi", "kothari"]);
  const distinctive = firstLastClose(item.entry.name, item.member.name) && last.length >= 5 && !commonLast.has(last);
  const strong = exact || coded || mobileMatch || distinctive;

  if (currentPrimary && currentPrimary.room_id === item.room.id) {
    alreadyOk.push(item);
    continue;
  }
  if (currentPrimary) {
    if (!strong) {
      issues.push({ type: "weak_match_already_allocated", ...item.entry, memberName: item.member.name, from: roomById.get(currentPrimary.room_id)?.room_number, to: item.room.room_number });
      continue;
    }
    updates.push({ ...item, existing: currentPrimary });
    continue;
  }
  inserts.push(item);
}

const newPeople = [];
for (const issue of issues) {
  if (issue.type !== "family_not_found" && issue.type !== "member_not_found") continue;
  const resolved = resolveRoom(issue.roomLabel, rooms);
  if (resolved.status !== "ok") continue;
  const family = issue.code ? familiesByCode.get(issue.code) : null;
  newPeople.push({
    entry: issue,
    family,
    room: resolved.room
  });
}

const summary = {
  apply: APPLY,
  excelRows: excelRows.length,
  matched: planned.length,
  alreadyAllocatedCorrectly: alreadyOk.length,
  toMove: updates.length,
  toInsert: inserts.length,
  extraAllocationsToDrop: extraAllocDeletes.length,
  duplicateMembersToMerge: extraMemberDeletes.length,
  newPeopleToAdd: newPeople.length,
  issues: issues.length,
  issueCounts: issues.reduce((acc, issue) => {
    acc[issue.type] = (acc[issue.type] || 0) + 1;
    return acc;
  }, {}),
  moves: updates.map((item) => ({
    name: item.member.name,
    excel: item.entry.name,
    from: roomById.get(item.existing.room_id)?.room_number,
    to: item.room.room_number,
    code: item.entry.code
  })),
  inserts: inserts.map((item) => ({ name: item.member.name, to: item.room.room_number, code: item.entry.code })),
  merges: extraMemberDeletes.map((item) => ({
    keep: item.keep.name,
    drop: item.extra.name,
    dropHead: Boolean(item.extra.is_head),
    dropFamily: item.extraFamily?.head_name,
    dropPothi: item.extraFamily?.pothi_id,
    to: item.room.room_number
  })),
  extraAllocs: extraAllocDeletes.map((item) => ({
    name: item.member.name,
    dropRoom: roomById.get(item.allocation.room_id)?.room_number,
    keepRoom: item.room.room_number
  })),
  pending: issues.filter((issue) => issue.type === "room_pending").map((issue) => `${issue.name} / ${issue.code}`),
  ambiguousRooms: issues.filter((issue) => issue.type === "room_ambiguous").map((issue) => `${issue.name} -> ${issue.roomLabel} [${(issue.candidates || []).join(" | ")}]`),
  unmappedRooms: issues.filter((issue) => issue.type === "room_unmapped").map((issue) => `${issue.name} -> ${issue.roomLabel}`),
  missingFamilies: [...new Set(issues.filter((issue) => issue.type === "family_not_found").map((issue) => `${issue.name} / ${issue.code}`))],
  missingMembers: issues.filter((issue) => issue.type === "member_not_found").map((issue) => `${issue.name} / ${issue.code}`),
  ambiguousMembers: issues.filter((issue) => issue.type === "member_ambiguous").map((issue) => `${issue.name} / ${issue.code}`),
  newPeople: newPeople.map((item) => ({
    name: item.entry.name,
    code: item.entry.code,
    city: item.entry.city,
    to: item.room.room_number,
    existingFamily: item.family?.head_name ?? null
  }))
};

console.log(JSON.stringify(summary, null, 2));
if (!APPLY) process.exit(0);

for (const item of extraAllocDeletes) {
  const { error } = await db.from("room_allocations").delete().eq("id", item.allocation.id);
  if (error) throw new Error(`Drop extra allocation for ${item.member.name}: ${error.message}`);
}

for (const item of extraMemberDeletes) {
  if (item.extra.is_head) continue;
  for (const alloc of item.extraAllocs) {
    const { error } = await db.from("room_allocations").delete().eq("id", alloc.id);
    if (error) throw new Error(`Drop duplicate allocation for ${item.extra.name}: ${error.message}`);
  }
  const { error } = await db.from("members").delete().eq("id", item.extra.id);
  if (error) throw new Error(`Drop duplicate member ${item.extra.name}: ${error.message}`);
}

const createdFamilyByKey = new Map();
let createdMembers = 0;
let createdFamilies = 0;
let createdAllocsForNew = 0;

function familyKey(item) {
  if (item.entry.code) return `code:${item.entry.code}`;
  return `new:${item.entry.city || "NA"}|${item.room.id}|${item.entry.sheet}`;
}

for (const item of newPeople) {
  let family = item.family;
  if (!family) {
    const key = familyKey(item);
    if (createdFamilyByKey.has(key)) family = createdFamilyByKey.get(key);
    else if (item.entry.code && familiesByCode.get(item.entry.code)) family = familiesByCode.get(item.entry.code);
    else {
      const familyRow = {
        head_name: item.entry.name,
        head_mobile: item.entry.mobile || "0000000000",
        city: item.entry.city || null,
        address: "General Entry allocation import",
        wants_stay: true,
        registration_type: "general_room",
        stay_from: item.entry.arrival,
        stay_to: item.entry.departure
      };
      if (item.entry.code) familyRow.registration_code = item.entry.code;
      const { data, error } = await db.from("families").insert(familyRow).select("id, head_name, registration_code").single();
      if (error) throw new Error(`Create family for ${item.entry.name}: ${error.message}`);
      family = data;
      createdFamilyByKey.set(key, family);
      if (item.entry.code) familiesByCode.set(item.entry.code, family);
      createdFamilies += 1;
    }
  }

  const { data: member, error: memberError } = await db.from("members").insert({
    family_id: family.id,
    name: item.entry.name,
    mobile: item.entry.mobile || null,
    gender: ["male", "female", "other"].includes(item.entry.gender) ? item.entry.gender : "other",
    age: Number.isFinite(item.entry.age) ? item.entry.age : 0,
    is_head: !item.family && family.head_name === item.entry.name,
    arrival_date: item.entry.arrival,
    departure_date: item.entry.departure
  }).select("id").single();
  if (memberError) throw new Error(`Create member ${item.entry.name}: ${memberError.message}`);
  createdMembers += 1;

  const { error: allocError } = await db.from("room_allocations").insert({
    room_id: item.room.id,
    member_id: member.id,
    family_id: family.id
  });
  if (allocError) throw new Error(`Allocate new member ${item.entry.name}: ${allocError.message}`);
  createdAllocsForNew += 1;
}

for (const item of inserts) {
  const { error } = await db.from("room_allocations").insert({
    room_id: item.room.id,
    member_id: item.member.id,
    family_id: item.family.id
  });
  if (error) throw new Error(`Insert failed for ${item.entry.name}: ${error.message}`);
}

for (const item of updates) {
  const { error } = await db.from("room_allocations").update({ room_id: item.room.id, family_id: item.family.id }).eq("id", item.existing.id);
  if (error) throw new Error(`Move failed for ${item.entry.name}: ${error.message}`);
}

const familyIds = [...new Set([...inserts, ...updates].map((item) => item.family.id))];
for (let i = 0; i < familyIds.length; i += 100) {
  const chunk = familyIds.slice(i, i + 100);
  const { error } = await db.from("families").update({ wants_stay: true }).in("id", chunk);
  if (error) throw error;
}

console.log(JSON.stringify({
  inserted: inserts.length,
  moved: updates.length,
  extraAllocationsDropped: extraAllocDeletes.length,
  duplicateMembersRemoved: extraMemberDeletes.filter((item) => !item.extra.is_head).length,
  familiesStayOn: familyIds.length,
  createdFamilies,
  createdMembers,
  createdAllocsForNew
}));
