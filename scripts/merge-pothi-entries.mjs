import fs from "node:fs";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const WORKBOOK = "C:/Users/DELL/Downloads/Pothi_wise_members.xlsx";

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

function stemToken(value) {
  return String(value ?? "").replace(/(ben|bhai|ji)$/g, "");
}

function closeToken(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const a = stemToken(left);
  const b = stemToken(right);
  return Boolean(a && b && a === b);
}

function firstLastClose(a, b) {
  const left = tokensOf(a);
  const right = tokensOf(b);
  if (left.length < 2 || right.length < 2) return false;
  return closeToken(left[0], right[0]) && closeToken(left.at(-1), right.at(-1));
}

function exactName(a, b) {
  return Boolean(normalizeName(a) && normalizeName(a) === normalizeName(b));
}

function nameScore(entryName, memberName) {
  if (exactName(entryName, memberName)) return 1;
  if (firstLastClose(entryName, memberName)) return 0.94;
  const left = tokensOf(entryName);
  const right = tokensOf(memberName);
  if (!left.length || !right.length) return 0;
  const overlap = left.filter((token) => right.some((part) => closeToken(token, part)));
  if (overlap.length >= 2) return 0.9;
  if (right.some((part) => closeToken(left[0], part)) && right.some((part) => closeToken(left.at(-1), part))) return 0.86;
  if (closeToken(left[0], right[0]) && (left.length === 1 || right.length === 1)) return 0.88;
  if (right.some((part) => closeToken(left[0], part))) return 0.84;
  return 0;
}

function compact(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function excelDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 40000) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return null;
}

function genderOf(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "male" || text === "m") return "male";
  if (text === "female" || text === "f") return "female";
  return "other";
}

function parseExcel() {
  const workbook = XLSX.readFile(WORKBOOK);
  const parsed = [];
  for (const sheetName of workbook.SheetNames) {
    const pothiMatch = String(sheetName).match(/^Pothi\s+(\d+)$/i);
    if (!pothiMatch) continue;
    const pothi = Number(pothiMatch[1]);
    if (!Number.isInteger(pothi) || pothi < 1 || pothi > 74) continue;
    const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null });
    const headerIndex = grid.findIndex((row) => Array.isArray(row) && String(row[1] ?? "").trim() === "Member Name");
    if (headerIndex < 0) continue;
    const header = grid[headerIndex].map((cell) => String(cell ?? "").trim());
    for (const line of grid.slice(headerIndex + 1)) {
      if (!Array.isArray(line) || !line[1]) continue;
      const row = Object.fromEntries(header.map((key, index) => [key, line[index]]));
      const venue = String(row.Venue ?? "").trim();
      const roomNo = String(row["Room Number"] ?? row["Room No"] ?? row.ROOM ?? "").trim();
      parsed.push({
        name: String(row["Member Name"] ?? "").trim(),
        age: row.Age == null || row.Age === "" ? null : Number(row.Age),
        gender: genderOf(row.Gender),
        mobile: digits(row["Member Mobile"]),
        familyName: String(row["Family / Yajman"] ?? "").trim(),
        familyMobile: digits(row["Family Mobile"]),
        city: String(row.City ?? "").trim(),
        code: String(row["Registration Code"] ?? "").trim().toUpperCase(),
        pothi,
        pothiRaw: String(pothi),
        arrival: excelDate(row["Arrival Date"]),
        departure: excelDate(row["Departure Date"]),
        venue,
        roomNo: roomNo || venue
      });
    }
  }
  return parsed.filter((row) => row.name && row.pothi);
}

function sectionHint(label) {
  const text = compact(label);
  if (text.includes("JAKH")) return "JAKHIBAI";
  if (text.includes("MARU")) return "MARU COMPLEX";
  if (text.includes("NAVNEETHALL") || (text.includes("NAVNEET") && text.includes("HALL"))) return "NAVNEET HALL";
  if (text.includes("NAVNEET")) return "NAVNEET COMPLEX";
  if (text.includes("BHUJVIEW")) return "BHUJ VIEW HOTEL";
  if (text.includes("SMRUTI")) return "SMRUTI HILLS HOTEL";
  if (text.includes("ATITHI")) return "ATITHI HOTEL";
  if (text.includes("VALIB")) return "VALIBEN HALL";
  if (text.includes("RATANBEN")) return "RATANBEN HALL";
  if (text.includes("ZAVER") || text.includes("JAVER")) return "ZAVERBEN HALL";
  if (text.includes("VSC")) return "V.S.C";
  if (text.includes("VBC") || text.includes("VAGAD")) return "VAGAD";
  if (text.includes("PRIVATEHOTEL") || text.includes("PRIVATEROOM") || text === "PRIVATE") return "PRIVATE HOTEL";
  if (text.includes("PENDING")) return "PENDING ALLOTMENT";
  if (text === "SPMCOMPLEXHALL" || text === "SPMHALL" || text.includes("SPMHALL")) return "SPM_HALL";
  if (text.includes("SPM")) return "S.P.M.COMPLEX";
  if (text.includes("RAJGOR")) return "RAJGOR";
  if (text.includes("PANVALLABH")) return "PANVALLABH";
  return null;
}

function resolveRoom(entry, rooms) {
  const label = `${entry.venue} ${entry.roomNo}`.trim();
  const upper = label.toUpperCase().replace(/\s+/g, " ").trim();
  if (!upper) return { status: "blank", room: null };
  if (upper.includes("PENDING")) {
    const pending = rooms.find((room) => compact(room.section_name).includes("PENDING") && String(room.source_room_number) === String(entry.pothi));
    return pending ? { status: "ok", room: pending } : { status: "pending", room: null };
  }
  if (compact(upper).includes("PRIVATE")) {
    const privateHotel = rooms.find((room) => compact(room.section_name) === "PRIVATEHOTEL" || compact(room.room_number) === "HOTELPRIVATEHOTEL");
    return privateHotel ? { status: "ok", room: privateHotel } : { status: "unmapped", room: null };
  }

  let source = null;
  let hint = sectionHint(entry.venue) || sectionHint(entry.roomNo) || sectionHint(upper);
  let floor = null;
  if (/\bG\.?F\.?\b|GROUND/.test(upper)) floor = "GF";
  else if (/\bF\.?F\.?\b|FIRST/.test(upper)) floor = "FF";
  else if (/\bS\.?F\.?\b|SECOND/.test(upper)) floor = "SF";

  const numberedA = String(entry.roomNo).toUpperCase().match(/^(\d+)\s*\/\s*(.+)$/);
  const numberedB = String(entry.roomNo).toUpperCase().match(/^([A-Z. ]+)\s*\/\s*(\d+)$/);
  if (numberedA) {
    source = numberedA[1];
    hint = sectionHint(numberedA[2]) || hint;
  } else if (numberedB) {
    source = numberedB[2];
    hint = sectionHint(numberedB[1]) || hint;
  } else if (/HALL|VALIBAI/i.test(upper)) {
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
    const wantedSource = String(source ?? "").replace(/^0+/, "") || "0";
    const roomSource = String(room.source_room_number ?? "").replace(/^0+/, "") || "0";
    const matchesSource = !source || wantedSource === roomSource || String(room.source_room_number) === String(source);
    const matchesFloor = !floor || compact(room.floor) === floor || roomNo.endsWith(floor);
    return matchesHint && matchesSource && matchesFloor;
  });

  if (candidates.length === 1) return { status: "ok", room: candidates[0] };
  if (source === "HALL") {
    const halls = candidates.filter((room) => String(room.source_room_number).toUpperCase() === "HALL");
    if (halls.length === 1) return { status: "ok", room: halls[0] };
    if (floor) {
      const floored = halls.filter((room) => compact(room.floor) === floor || compact(room.room_number).endsWith(floor));
      if (floored.length === 1) return { status: "ok", room: floored[0] };
    }
  }
  if (candidates.length > 1) return { status: "ambiguous", room: null, candidates: candidates.map((room) => room.room_number) };
  return { status: "unmapped", room: null };
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

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const excelRows = parseExcel();
const families = await fetchAll(db, "families", "id, head_name, head_mobile, city, registration_code, registration_type, pothi_id, reference_pothi_id");
const pothis = await fetchAll(db, "pothis", "id, family_id, primary_holder_name, city, contact_name, contact_mobile");
let members = await fetchAll(db, "members", "id, name, mobile, family_id, gender, age, is_head, arrival_date, departure_date");
let rooms = await fetchAll(db, "rooms", "id, room_number, venue_name, section_name, source_room_number, floor, capacity, room_type, owner_type, linked_pothi_id, ac_type, bed_count, extra_count, allotment_note, sort_order");
const allocations = await fetchAll(db, "room_allocations", "id, member_id, family_id, room_id");

const vscNeeded = [...new Set(excelRows.map((row) => {
  const match = String(row.roomNo).toUpperCase().match(/V\.?S\.?C\.?\s*\/\s*(\d+)/);
  return match ? match[1].padStart(2, "0") : null;
}).filter(Boolean))];
const vscTemplate = rooms.find((room) => compact(room.section_name) === "VSC");
const createdRooms = [];
if (vscTemplate) {
  for (const source of vscNeeded) {
    const exists = rooms.some((room) => compact(room.section_name) === "VSC" && String(room.source_room_number).padStart(2, "0") === source);
    if (exists) continue;
    const guestCount = excelRows.filter((row) => compact(row.roomNo).includes(`VSC${source}`) || compact(row.roomNo).includes(`VSC${Number(source)}`)).length;
    const payload = {
      room_number: `V.S.C. / V.S.C. / ${source}`,
      room_type: "general_room",
      capacity: Math.max(4, guestCount),
      venue_name: "V.S.C.",
      section_name: "V.S.C.",
      source_room_number: source,
      floor: "G.F.",
      ac_type: vscTemplate.ac_type,
      bed_count: vscTemplate.bed_count,
      extra_count: vscTemplate.extra_count,
      owner_type: "SAMAJ",
      allotment_note: `Pothi entries V.S.C/${source}`,
      sort_order: (vscTemplate.sort_order ?? 258) + Number(source)
    };
    if (APPLY) {
      const { data, error } = await db.from("rooms").insert(payload).select("*").single();
      if (error) throw new Error(`Create VSC ${source}: ${error.message}`);
      rooms.push(data);
      createdRooms.push(data.room_number);
    } else {
      rooms.push({ id: `dry-vsc-${source}`, ...payload });
      createdRooms.push(payload.room_number);
    }
  }
}

const createdFamilies = [];
for (const pothi of pothis) {
  if (pothi.family_id) continue;
  if (!excelRows.some((row) => row.pothi === pothi.id)) continue;
  const payload = {
    head_name: pothi.primary_holder_name,
    head_mobile: digits(pothi.contact_mobile) || "0000000000",
    city: pothi.city || null,
    wants_stay: true,
    pothi_id: pothi.id,
    registration_type: "pothi_room",
    stay_from: "2026-11-13",
    stay_to: "2026-11-20"
  };
  if (APPLY) {
    const { data: family, error } = await db.from("families").insert(payload).select("id, head_name, head_mobile, city, registration_code, registration_type, pothi_id, reference_pothi_id").single();
    if (error) throw new Error(`Create family pothi ${pothi.id}: ${error.message}`);
    const { error: pothiError } = await db.from("pothis").update({ family_id: family.id }).eq("id", pothi.id);
    if (pothiError) throw pothiError;
    const { data: head, error: headError } = await db.from("members").insert({
      family_id: family.id,
      name: pothi.primary_holder_name,
      mobile: digits(pothi.contact_mobile) || null,
      gender: "other",
      age: 0,
      is_head: true,
      arrival_date: "2026-11-13",
      departure_date: "2026-11-20"
    }).select("id, name, mobile, family_id, gender, age, is_head, arrival_date, departure_date").single();
    if (headError) throw headError;
    families.push(family);
    members.push(head);
    pothi.family_id = family.id;
    createdFamilies.push(pothi.id);
  } else {
    const family = { id: `dry-family-${pothi.id}`, ...payload, registration_code: null, reference_pothi_id: null };
    const head = { id: `dry-head-${pothi.id}`, family_id: family.id, name: pothi.primary_holder_name, mobile: digits(pothi.contact_mobile) || null, gender: "other", age: 0, is_head: true, arrival_date: "2026-11-13", departure_date: "2026-11-20" };
    families.push(family);
    members.push(head);
    pothi.family_id = family.id;
    createdFamilies.push(pothi.id);
  }
}

const familyById = new Map(families.map((family) => [family.id, family]));
const pothiFamilyId = new Map(pothis.filter((pothi) => pothi.family_id).map((pothi) => [pothi.id, pothi.family_id]));
const membersByFamily = new Map();
for (const member of members) {
  const list = membersByFamily.get(member.family_id) ?? [];
  list.push(member);
  membersByFamily.set(member.family_id, list);
}
const allocationsByMember = new Map();
const occupancy = new Map();
for (const row of allocations) {
  const list = allocationsByMember.get(row.member_id) ?? [];
  list.push(row);
  allocationsByMember.set(row.member_id, list);
  occupancy.set(row.room_id, (occupancy.get(row.room_id) ?? 0) + 1);
}
const roomById = new Map(rooms.map((room) => [room.id, room]));
const HALL_CAPS = new Set(rooms.filter((room) => String(room.source_room_number).toUpperCase() === "HALL").map((room) => room.id));

function pickUnique(scored) {
  const list = scored.filter((row) => row.score >= 0.84).sort((a, b) => b.score - a.score);
  if (!list.length) return null;
  if (list[1] && list[0].score - list[1].score < 0.03) return { ambiguous: list.slice(0, 3) };
  return list[0];
}

const usedMembers = new Set();

function matchEntry(entry, pothiFamily) {
  const scoreOf = (member) => ({ member, family: familyById.get(member.family_id), score: nameScore(entry.name, member.name) });
  const allPothiMembers = membersByFamily.get(pothiFamily.id) ?? [];
  const pothiMembers = allPothiMembers.filter((member) => !usedMembers.has(member.id));

  if (entry.mobile) {
    const onPothi = pothiMembers.filter((member) => digits(member.mobile).length === 10 && digits(member.mobile) === entry.mobile).map(scoreOf);
    const pickedPothi = pickUnique(onPothi);
    if (pickedPothi?.member) return { status: "ok", ...pickedPothi };
  }
  const exactPothi = pothiMembers.filter((member) => exactName(entry.name, member.name));
  if (exactPothi.length === 1) return { status: "ok", ...scoreOf(exactPothi[0]) };
  if (exactPothi.length > 1) {
    const unusedMobile = exactPothi.filter((member) => !entry.mobile || !digits(member.mobile) || digits(member.mobile) === entry.mobile);
    if (unusedMobile.length === 1) return { status: "ok", ...scoreOf(unusedMobile[0]) };
  }
  const closePothi = pickUnique(pothiMembers.map(scoreOf).filter((row) => row.score >= 0.94));
  if (closePothi?.member) return { status: "ok", ...closePothi };
  const usedClose = pickUnique(allPothiMembers.filter((member) => usedMembers.has(member.id)).map(scoreOf).filter((row) => row.score >= 0.94 || exactName(entry.name, row.member.name)));
  if (usedClose?.member) return { status: "already_used", ...usedClose };

  if (entry.mobile) {
    const hits = members.filter((member) => digits(member.mobile).length === 10 && digits(member.mobile) === entry.mobile);
    const scored = hits.map(scoreOf);
    const unused = scored.filter((row) => !usedMembers.has(row.member.id));
    const picked = pickUnique(unused.length ? unused : scored);
    if (picked?.ambiguous) return { status: "member_ambiguous", options: picked.ambiguous };
    if (picked?.member) return { status: "ok", ...picked };
  }

  const exacts = members.filter((member) => exactName(entry.name, member.name) && !usedMembers.has(member.id));
  if (exacts.length === 1) {
    const member = exacts[0];
    return { status: "ok", member, family: familyById.get(member.family_id), score: 1 };
  }
  if (exacts.length > 1) {
    const general = exacts.filter((member) => familyById.get(member.family_id)?.registration_type === "general_room");
    if (general.length === 1) return { status: "ok", member: general[0], family: familyById.get(general[0].family_id), score: 1 };
    return { status: "member_ambiguous", options: exacts.slice(0, 3).map((member) => ({ member, family: familyById.get(member.family_id), score: 1 })) };
  }
  return { status: "not_found" };
}

function duplicateExtras(entry, keep) {
  return members.filter((member) => {
    if (member.id === keep.id || usedMembers.has(member.id)) return false;
    const family = familyById.get(member.family_id);
    if (member.is_head && family?.registration_type === "pothi_room") return false;
    if (family?.registration_type === "pothi_room" && family.pothi_id && family.pothi_id !== entry.pothi) return false;
    if (!exactName(entry.name, member.name) && nameScore(entry.name, member.name) < 0.94) return false;
    const extraMobile = digits(member.mobile);
    const keepMobile = digits(keep.mobile) || entry.mobile;
    if (extraMobile.length === 10 && keepMobile.length === 10) return extraMobile === keepMobile;
    return extraMobile.length !== 10;
  });
}

const issues = [];
const alreadyOk = [];
const moves = [];
const attaches = [];
const creates = [];
const merges = [];

for (const entry of excelRows) {
  const pothiFamily = pothiFamilyId.get(entry.pothi) ? familyById.get(pothiFamilyId.get(entry.pothi)) : null;
  if (!pothiFamily) {
    issues.push({ type: "pothi_has_no_family", ...entry });
    continue;
  }
  const resolved = resolveRoom(entry, rooms);
  if (resolved.status !== "ok") {
    issues.push({ type: `room_${resolved.status}`, ...entry, candidates: resolved.candidates ?? [] });
    continue;
  }
  const room = resolved.room;
  const matched = matchEntry(entry, pothiFamily);

  if (matched.status === "member_ambiguous") {
    issues.push({ type: "member_ambiguous", ...entry, options: matched.options.map((row) => row.member.name) });
    continue;
  }
  if (matched.status === "already_used") continue;

  const hallFull = HALL_CAPS.has(room.id) && (occupancy.get(room.id) ?? 0) >= room.capacity;

  if (matched.status !== "ok") {
    if (hallFull) {
      issues.push({ type: "hall_full_new", ...entry, room: room.room_number, cap: room.capacity });
      continue;
    }
    creates.push({ entry, pothiFamily, room });
    occupancy.set(room.id, (occupancy.get(room.id) ?? 0) + 1);
    continue;
  }

  const member = matched.member;
  const family = matched.family;
  if (usedMembers.has(member.id)) continue;
  usedMembers.add(member.id);

  const existing = allocationsByMember.get(member.id) ?? [];
  const currentRoomId = existing[0]?.room_id ?? null;
  const onPothi = member.family_id === pothiFamily.id;

  if (family?.registration_type === "pothi_room" && family.pothi_id && family.pothi_id !== entry.pothi) {
    issues.push({ type: "other_pothi", ...entry, current: family.pothi_id, memberName: member.name });
    continue;
  }

  for (const extra of duplicateExtras(entry, member)) {
    merges.push({ keep: member, extra, extraFamily: familyById.get(extra.family_id), extraAllocs: allocationsByMember.get(extra.id) ?? [], entry });
    usedMembers.add(extra.id);
  }

  if (onPothi && currentRoomId === room.id) {
    alreadyOk.push({ entry, member, room });
    continue;
  }

  if (hallFull && currentRoomId !== room.id) {
    issues.push({ type: "hall_full_move", ...entry, memberName: member.name, from: roomById.get(currentRoomId)?.room_number, to: room.room_number });
    continue;
  }

  if (onPothi) {
    moves.push({ entry, member, family: pothiFamily, room, existing });
    if (currentRoomId !== room.id) occupancy.set(room.id, (occupancy.get(room.id) ?? 0) + 1);
    continue;
  }

  if (member.is_head && family?.registration_type === "pothi_room") {
    issues.push({ type: "skip_pothi_head", ...entry, memberName: member.name });
    continue;
  }

  attaches.push({ entry, member, fromFamily: family, pothiFamily, room, existing, wasHead: member.is_head });
  if (currentRoomId !== room.id) occupancy.set(room.id, (occupancy.get(room.id) ?? 0) + 1);
}

console.log(JSON.stringify({
  apply: APPLY,
  excelRows: excelRows.length,
  createdVscRooms: createdRooms,
  createdPothiFamilies: createdFamilies,
  alreadyCorrect: alreadyOk.length,
  attachToPothi: attaches.length,
  createOnPothi: creates.length,
  mergeDoubles: merges.length,
  moveRoom: moves.length,
  issues: issues.length,
  issueTypes: issues.reduce((acc, issue) => {
    acc[issue.type] = (acc[issue.type] || 0) + 1;
    return acc;
  }, {}),
  attachSample: attaches.slice(0, 20).map((item) => ({
    name: item.entry.name,
    pothi: item.entry.pothi,
    from: item.fromFamily?.head_name,
    fromType: item.fromFamily?.registration_type,
    room: item.entry.roomNo,
    match: item.member.name
  })),
  createSample: creates.slice(0, 20).map((item) => ({ name: item.entry.name, pothi: item.entry.pothi, room: item.entry.roomNo })),
  unmapped: issues.filter((issue) => issue.type === "room_unmapped").map((issue) => `${issue.name} -> ${issue.roomNo}`),
  ambiguousRooms: issues.filter((issue) => issue.type === "room_ambiguous").map((issue) => `${issue.name} -> ${issue.roomNo} (${(issue.candidates || []).join(",")})`),
  ambiguousMembers: issues.filter((issue) => issue.type === "member_ambiguous").map((issue) => `${issue.name} -> ${(issue.options || []).join(",")}`),
  otherPothi: issues.filter((issue) => issue.type === "other_pothi").map((issue) => `${issue.name} pothi ${issue.pothi} currently ${issue.current}`),
  noFamily: [...new Set(issues.filter((issue) => issue.type === "pothi_has_no_family").map((issue) => issue.pothi))],
  hallFull: issues.filter((issue) => issue.type.startsWith("hall_full")).map((issue) => issue.name)
}, null, 2));

if (!APPLY) process.exit(0);

async function setAllocation(memberId, familyId, roomId) {
  const { data: existing, error: existingError } = await db.from("room_allocations").select("id, room_id").eq("member_id", memberId);
  if (existingError) throw existingError;
  const rows = existing ?? [];
  if (rows[0]?.room_id === roomId) {
    if (rows[0].id) await db.from("room_allocations").update({ family_id: familyId }).eq("id", rows[0].id);
    for (const extra of rows.slice(1)) {
      const { error } = await db.from("room_allocations").delete().eq("id", extra.id);
      if (error) throw error;
    }
    return;
  }
  if (rows[0]) {
    const { error } = await db.from("room_allocations").update({ room_id: roomId, family_id: familyId }).eq("id", rows[0].id);
    if (error) throw error;
    for (const extra of rows.slice(1)) {
      const { error } = await db.from("room_allocations").delete().eq("id", extra.id);
      if (error) throw error;
    }
    return;
  }
  const { error } = await db.from("room_allocations").insert({ member_id: memberId, family_id: familyId, room_id: roomId });
  if (error) throw error;
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

for (const item of merges) {
  if (item.extra.is_head && item.extraFamily?.registration_type === "pothi_room") continue;
  if (item.extra.is_head) await maybePromoteHead(item.extra.family_id, item.extra.id);
  const { error: allocError } = await db.from("room_allocations").delete().eq("member_id", item.extra.id);
  if (allocError) throw allocError;
  const { error } = await db.from("members").delete().eq("id", item.extra.id);
  if (error) throw new Error(`Drop duplicate ${item.extra.name}: ${error.message}`);
}

for (const item of moves) {
  await setAllocation(item.member.id, item.family.id, item.room.id);
}

for (const item of attaches) {
  if (item.wasHead) await maybePromoteHead(item.member.family_id, item.member.id);
  const { error } = await db.from("members").update({
    family_id: item.pothiFamily.id,
    is_head: false,
    name: item.entry.name,
    arrival_date: item.entry.arrival,
    departure_date: item.entry.departure,
    age: Number.isFinite(item.entry.age) ? item.entry.age : item.member.age,
    gender: item.entry.gender || item.member.gender
  }).eq("id", item.member.id);
  if (error) throw new Error(`Attach ${item.member.name}: ${error.message}`);
  await setAllocation(item.member.id, item.pothiFamily.id, item.room.id);
}

for (const item of creates) {
  const { data: member, error } = await db.from("members").insert({
    family_id: item.pothiFamily.id,
    name: item.entry.name,
    mobile: item.entry.mobile || null,
    gender: item.entry.gender,
    age: Number.isFinite(item.entry.age) ? item.entry.age : 0,
    is_head: false,
    arrival_date: item.entry.arrival,
    departure_date: item.entry.departure
  }).select("id").single();
  if (error) throw new Error(`Create ${item.entry.name}: ${error.message}`);
  await setAllocation(member.id, item.pothiFamily.id, item.room.id);
}

const pothiFamilyIds = [...new Set([...moves, ...attaches, ...creates].map((item) => (item.family ?? item.pothiFamily).id))];
for (let i = 0; i < pothiFamilyIds.length; i += 100) {
  const chunk = pothiFamilyIds.slice(i, i + 100);
  const { error } = await db.from("families").update({ wants_stay: true }).in("id", chunk);
  if (error) throw error;
}

const leftoverFamilies = [...new Set([
  ...attaches.map((item) => item.fromFamily?.id),
  ...merges.map((item) => item.extraFamily?.id)
].filter(Boolean))];
let deletedEmpty = 0;
for (const familyId of leftoverFamilies) {
  const family = familyById.get(familyId);
  if (family?.registration_type === "pothi_room" || family?.pothi_id) continue;
  const { count, error } = await db.from("members").select("id", { count: "exact", head: true }).eq("family_id", familyId);
  if (error) throw error;
  if (count) continue;
  await db.from("room_allocations").delete().eq("family_id", familyId);
  const { error: delError } = await db.from("families").delete().eq("id", familyId);
  if (delError) throw delError;
  deletedEmpty += 1;
}

console.log(JSON.stringify({
  movedRooms: moves.length,
  attachedToPothi: attaches.length,
  createdOnPothi: creates.length,
  mergedDropped: merges.length,
  deletedEmptyFamilies: deletedEmpty
}, null, 2));
