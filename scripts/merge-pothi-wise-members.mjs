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

function parseExcel() {
  const workbook = XLSX.readFile(WORKBOOK);
  const sheet = workbook.Sheets["Pothi-wise"];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  return rows.map((row) => {
    const pothiRaw = String(row.Pothi ?? "").trim();
    const pothi = Number(pothiRaw);
    return {
      name: String(row["Member Name"] ?? "").trim(),
      age: row.Age == null || row.Age === "" ? null : Number(row.Age),
      gender: String(row.Gender ?? "").trim().toLowerCase(),
      mobile: digits(row["Member Mobile"]),
      familyName: String(row["Family / Yajman"] ?? "").trim(),
      familyMobile: digits(row["Family Mobile"]),
      city: String(row.City ?? "").trim(),
      code: String(row["Registration Code"] ?? "").trim().toUpperCase(),
      pothi: Number.isInteger(pothi) && pothi >= 1 && pothi <= 74 ? pothi : null,
      pothiRaw,
      arrival: excelDate(row["Arrival Date"]),
      departure: excelDate(row["Departure Date"]),
      venue: String(row.Venue ?? "").trim(),
      roomNo: String(row["Room No"] ?? "").trim()
    };
  }).filter((row) => row.name && row.pothi);
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
  if (text.includes("PRIVATEHOTEL") || text === "PRIVATE") return "PRIVATE HOTEL";
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
  if (compact(upper) === "PRIVATE" || compact(upper) === "PRIVATEHOTEL" || compact(upper) === "PRIVATEPRIVATE") {
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
    const matchesSource = !source || String(room.source_room_number) === String(source);
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
    const first = page[0];
    if (first?.id && all.some((row) => row.id === first.id)) break;
    all.push(...page);
    if (page.length < 400) break;
  }
  return all;
}

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const excelRows = parseExcel();
const families = await fetchAll(db, "families", "id, head_name, head_mobile, city, registration_code, registration_type, pothi_id, reference_pothi_id, wants_stay");
const pothis = await fetchAll(db, "pothis", "id, family_id, primary_holder_name");
const members = await fetchAll(db, "members", "id, name, mobile, family_id, gender, age, is_head, arrival_date, departure_date");
const rooms = await fetchAll(db, "rooms", "id, room_number, venue_name, section_name, source_room_number, floor, capacity, room_type, owner_type, linked_pothi_id");
const allocations = await fetchAll(db, "room_allocations", "id, member_id, family_id, room_id");

const familyById = new Map(families.map((family) => [family.id, family]));
const familiesByCode = new Map(families.map((family) => [String(family.registration_code ?? "").toUpperCase(), family]));
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

function scoreAgainst(entry, member, family) {
  const exact = exactName(entry.name, member.name);
  const firstLast = firstLastClose(entry.name, member.name);
  const mobileMatch = Boolean(entry.mobile && digits(member.mobile).length === 10 && entry.mobile === digits(member.mobile));
  const codeMatch = Boolean(entry.code && family?.registration_code && entry.code === String(family.registration_code).toUpperCase());
  if (!exact && !(firstLast && (mobileMatch || codeMatch))) return 0;
  if (exact && (codeMatch || mobileMatch)) return 1;
  if (exact) return 0.96;
  if (firstLast && codeMatch) return 0.94;
  if (firstLast && mobileMatch) return 0.93;
  return 0;
}

function pickUnique(scored) {
  const list = scored.filter((row) => row.score >= 0.93).sort((a, b) => b.score - a.score);
  if (!list.length) return null;
  if (list[1] && list[0].score - list[1].score < 0.03) return { ambiguous: list.slice(0, 3) };
  return list[0];
}

function chooseFrom(list) {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const heads = list.filter((member) => member.is_head);
  if (heads.length === 1) return heads[0];
  return null;
}

function matchEntry(entry) {
  const family = entry.code ? familiesByCode.get(entry.code) : null;
  const annotate = (member) => ({
    member,
    family: familyById.get(member.family_id),
    score: scoreAgainst(entry, member, familyById.get(member.family_id))
  });

  if (entry.mobile) {
    const hits = members.filter((member) => digits(member.mobile).length === 10 && digits(member.mobile) === entry.mobile);
    const scoped = family ? hits.filter((member) => member.family_id === family.id) : hits;
    const pool = scoped.length ? scoped : hits;
    const named = pool.filter((member) => exactName(entry.name, member.name) || firstLastClose(entry.name, member.name));
    const chosen = chooseFrom(named.length ? named : pool);
    if (chosen) return { status: "ok", ...annotate(chosen) };
    if (pool.length > 1) return { status: "member_ambiguous", options: pool.slice(0, 3).map(annotate) };
  }

  if (family) {
    const familyMembers = membersByFamily.get(family.id) ?? [];
    const exacts = familyMembers.filter((member) => exactName(entry.name, member.name));
    const unused = exacts.filter((member) => !usedMembers.has(member.id));
    if (!unused.length && exacts.length) return { status: "already_used" };
    const chosen = chooseFrom(unused);
    if (chosen) return { status: "ok", ...annotate(chosen) };
    if (exacts.length > 1) return { status: "member_ambiguous", options: exacts.slice(0, 3).map(annotate) };
  }

  const exacts = members.filter((member) => exactName(entry.name, member.name));
  const unused = exacts.filter((member) => !usedMembers.has(member.id));
  if (!unused.length && exacts.length) return { status: "already_used" };
  const chosen = chooseFrom(unused);
  if (chosen) return { status: "ok", ...annotate(chosen) };
  if (exacts.length > 1) return { status: "member_ambiguous", options: exacts.slice(0, 3).map(annotate) };

  return { status: "not_found" };
}

function duplicateOnPothi(entry, pothiMembers, keep) {
  return pothiMembers.filter((member) => {
    if (member.id === keep.id) return false;
    const sameName = exactName(entry.name, member.name);
    const extraMobile = digits(member.mobile);
    const keepMobile = digits(keep.mobile) || entry.mobile;
    if (extraMobile.length === 10 && keepMobile.length === 10 && extraMobile !== keepMobile) return false;
    const sameMobile = keepMobile.length === 10 && extraMobile === keepMobile;
    if (sameMobile && (sameName || firstLastClose(entry.name, member.name))) return true;
    return sameName && extraMobile.length !== 10;
  });
}

const issues = [];
const alreadyOk = [];
const moves = [];
const attaches = [];
const creates = [];
const merges = [];
const usedMembers = new Set();

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
  const matched = matchEntry(entry);
  const pothiMembers = membersByFamily.get(pothiFamily.id) ?? [];

  if (matched.status === "member_ambiguous") {
    issues.push({ type: "member_ambiguous", ...entry, options: matched.options.map((row) => row.member.name) });
    continue;
  }

  if (matched.status === "already_used") continue;

  if (matched.status !== "ok") {
    const hallFull = HALL_CAPS.has(room.id) && (occupancy.get(room.id) ?? 0) >= room.capacity;
    if (hallFull) {
      issues.push({ type: "hall_full_new", ...entry, room: room.room_number, cap: room.capacity });
      continue;
    }
    creates.push({ entry, pothiFamily, room });
    occupancy.set(room.id, (occupancy.get(room.id) ?? 0) + 1);
    continue;
  }

  const member = matched.member;
  if (usedMembers.has(member.id)) {
    continue;
  }
  usedMembers.add(member.id);

  const existing = allocationsByMember.get(member.id) ?? [];
  const currentRoomId = existing[0]?.room_id ?? null;
  const onPothi = member.family_id === pothiFamily.id;
  const extras = duplicateOnPothi(entry, pothiMembers, member);

  for (const extra of extras) {
    if (extra.is_head && extra.family_id === pothiFamily.id) continue;
    if (usedMembers.has(extra.id)) continue;
    merges.push({
      keep: member,
      extra,
      extraFamily: familyById.get(extra.family_id),
      extraAllocs: allocationsByMember.get(extra.id) ?? [],
      entry,
      room
    });
    usedMembers.add(extra.id);
  }

  if (onPothi && currentRoomId === room.id) {
    alreadyOk.push({ entry, member, room });
    continue;
  }

  const hallFull = HALL_CAPS.has(room.id) && (occupancy.get(room.id) ?? 0) >= room.capacity && currentRoomId !== room.id;
  if (hallFull) {
    issues.push({ type: "hall_full_move", ...entry, memberName: member.name, from: roomById.get(currentRoomId)?.room_number, to: room.room_number });
    continue;
  }

  if (onPothi) {
    moves.push({ entry, member, family: pothiFamily, room, existing });
  } else {
    if (member.is_head && member.family_id !== pothiFamily.id) {
      const otherMembers = (membersByFamily.get(member.family_id) ?? []).filter((row) => row.id !== member.id);
      attaches.push({ entry, member, fromFamily: matched.family, pothiFamily, room, existing, wasHead: true, leftover: otherMembers.length });
    } else {
      attaches.push({ entry, member, fromFamily: matched.family, pothiFamily, room, existing, wasHead: false, leftover: 0 });
    }
  }

  if (currentRoomId && currentRoomId !== room.id) occupancy.set(currentRoomId, Math.max(0, (occupancy.get(currentRoomId) ?? 1) - 1));
  if (currentRoomId !== room.id) occupancy.set(room.id, (occupancy.get(room.id) ?? 0) + 1);
}

const summary = {
  apply: APPLY,
  excelPothiRows: excelRows.length,
  alreadyCorrect: alreadyOk.length,
  moveRoomOnPothi: moves.length,
  attachToPothi: attaches.length,
  createOnPothi: creates.length,
  mergeDuplicates: merges.length,
  issues: issues.length,
  issueCounts: issues.reduce((acc, issue) => {
    acc[issue.type] = (acc[issue.type] || 0) + 1;
    return acc;
  }, {}),
  attachesByPothi: attaches.reduce((acc, item) => {
    acc[item.entry.pothi] = (acc[item.entry.pothi] || 0) + 1;
    return acc;
  }, {}),
  createsByPothi: creates.reduce((acc, item) => {
    acc[item.entry.pothi] = (acc[item.entry.pothi] || 0) + 1;
    return acc;
  }, {}),
  attachSample: attaches.slice(0, 40).map((item) => ({
    name: item.member.name,
    excel: item.entry.name,
    from: item.fromFamily?.head_name,
    fromCode: item.fromFamily?.registration_code,
    fromPothi: item.fromFamily?.pothi_id,
    toPothi: item.entry.pothi,
    room: item.room.room_number,
    wasHead: item.wasHead,
    leftover: item.leftover
  })),
  createSample: creates.slice(0, 40).map((item) => ({
    name: item.entry.name,
    code: item.entry.code,
    pothi: item.entry.pothi,
    room: item.room.room_number
  })),
  moveSample: moves.slice(0, 30).map((item) => ({
    name: item.member.name,
    pothi: item.entry.pothi,
    from: roomById.get(item.existing[0]?.room_id)?.room_number ?? null,
    to: item.room.room_number
  })),
  mergeSample: merges.slice(0, 30).map((item) => ({
    keep: item.keep.name,
    drop: item.extra.name,
    dropHead: Boolean(item.extra.is_head),
    dropPothi: item.extraFamily?.pothi_id,
    pothi: item.entry.pothi
  })),
  ambiguousMembers: issues.filter((issue) => issue.type === "member_ambiguous").map((issue) => ({
    name: issue.name,
    pothi: issue.pothi,
    code: issue.code,
    mobile: issue.mobile,
    room: issue.roomNo,
    options: issue.options
  })),
  unmappedRooms: issues.filter((issue) => issue.type === "room_unmapped").map((issue) => `${issue.name} -> ${issue.venue} ${issue.roomNo}`),
  ambiguousRooms: issues.filter((issue) => issue.type === "room_ambiguous").map((issue) => `${issue.name} -> ${issue.venue} ${issue.roomNo}`),
  hallFull: issues.filter((issue) => issue.type.startsWith("hall_full")),
  noFamily: issues.filter((issue) => issue.type === "pothi_has_no_family").map((issue) => issue.pothi)
};

console.log(JSON.stringify(summary, null, 2));
if (!APPLY) process.exit(0);

function genderOf(value) {
  if (value === "male" || value === "female" || value === "other") return value;
  if (value === "m") return "male";
  if (value === "f") return "female";
  return "other";
}

for (const item of merges) {
  if (item.extra.is_head && item.extraFamily?.pothi_id) continue;
  if (item.extra.is_head) continue;
  for (const alloc of item.extraAllocs) {
    const { error } = await db.from("room_allocations").delete().eq("id", alloc.id);
    if (error) throw new Error(`Drop duplicate allocation ${item.extra.name}: ${error.message}`);
  }
  const { error } = await db.from("members").delete().eq("id", item.extra.id);
  if (error) throw new Error(`Drop duplicate member ${item.extra.name}: ${error.message}`);
}

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

for (const item of moves) {
  await setAllocation(item.member.id, item.family.id, item.room.id);
}

for (const item of attaches) {
  const { error } = await db.from("members").update({
    family_id: item.pothiFamily.id,
    is_head: false,
    arrival_date: item.entry.arrival,
    departure_date: item.entry.departure
  }).eq("id", item.member.id);
  if (error) throw new Error(`Attach ${item.member.name}: ${error.message}`);
  await setAllocation(item.member.id, item.pothiFamily.id, item.room.id);
}

for (const item of creates) {
  const { data: member, error } = await db.from("members").insert({
    family_id: item.pothiFamily.id,
    name: item.entry.name,
    mobile: item.entry.mobile || null,
    gender: genderOf(item.entry.gender),
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

console.log(JSON.stringify({
  movedRooms: moves.length,
  attachedToPothi: attaches.length,
  createdOnPothi: creates.length,
  mergedDropped: merges.filter((item) => !item.extra.is_head).length,
  skippedHeadMerges: merges.filter((item) => item.extra.is_head).length
}));
