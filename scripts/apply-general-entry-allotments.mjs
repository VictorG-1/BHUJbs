import fs from "node:fs";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const WORKBOOK = resolveWorkbook("C:/Users/DELL/Desktop/BHAGWAT/GENERAL ENTRY.xlsx");

function resolveWorkbook(fallback) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--apply");
  const fileFlag = args.indexOf("--file");
  const fromFlag = fileFlag >= 0 ? args[fileFlag + 1] : null;
  const fromPositional = args.find((arg) => !arg.startsWith("-") && /\.xlsx$/i.test(arg));
  const candidate = fromFlag || fromPositional || process.env.WORKBOOK_PATH || fallback;
  if (!candidate || !fs.existsSync(candidate)) {
    throw new Error(`Workbook not found${candidate ? `: ${candidate}` : ""}. Pass --file <path> to an .xlsx file.`);
  }
  return candidate;
}

function env(key) {
  const line = fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}=`));
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

function closeToken(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 4 && right.length >= 4 && (left.startsWith(right.slice(0, 4)) || right.startsWith(left.slice(0, 4)))) return true;
  if (left.slice(1) === right.slice(1) && left.length >= 5) return true;
  return false;
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
  if (firstClose && leftTokens.length === 1) return 0.72;
  const overlap = rightTokens.filter((part) => leftTokens.some((token) => closeToken(token, part))).length;
  if (!overlap) return 0;
  return (overlap / Math.max(leftTokens.length, rightTokens.length)) * 0.8;
}

function isBhuj(value) {
  return /bhuj|ભુજ/i.test(String(value ?? ""));
}

function compact(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function parseExcel() {
  const workbook = XLSX.readFile(WORKBOOK);
  const rows = [];
  for (const sheet of workbook.SheetNames) {
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, defval: null }).slice(1);
    for (const row of data) {
      const name = String(row[0] ?? "").trim();
      const room = String(row[8] ?? "").trim();
      if (!name && !room) continue;
      rows.push({
        sheet,
        name,
        age: row[1],
        gender: String(row[2] ?? "").toLowerCase(),
        mobile: digits(row[3]),
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
  if (text.includes("NAVNEET")) return "NAVNEET COMPLEX";
  if (text.includes("BHUJVIEW") || text.includes("BHUJVIEWHOTEL")) return "BHUJ VIEW HOTEL";
  if (text.includes("SMRUTI")) return "SMRUTI HILLS HOTEL";
  if (text.includes("ATITHI")) return "ATITHI HOTEL";
  if (text.includes("VALIB")) return "VALIBEN HALL";
  if (text.includes("RATANBEN")) return "RATANBEN HALL";
  if (text === "SPMCOMPLEXHALL" || text === "SPMHALL" || text === "SPMCOMPLEX") return "S.P.M.COMPLEX";
  if (text.includes("SPM") || text.includes("S.P.M")) return "S.P.M.COMPLEX";
  return null;
}

function resolveRoom(label, rooms) {
  const raw = String(label ?? "").trim();
  if (!raw) return { status: "blank", room: null };
  const upper = raw.toUpperCase().replace(/\s+/g, " ").trim();
  if (upper === "PENDING") return { status: "pending", room: null };
  if (upper === "PRIVATE HOTEL") return { status: "ambiguous", room: null };

  let source = null;
  let hint = sectionHint(upper);
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

  const candidates = rooms.filter((room) => {
    const section = compact(room.section_name);
    const venue = compact(room.venue_name);
    const roomNo = compact(room.room_number);
    const matchesHint = !hint || section.includes(compact(hint)) || venue.includes(compact(hint)) || roomNo.includes(compact(hint));
    const matchesSource = !source || String(room.source_room_number) === String(source);
    return matchesHint && matchesSource;
  });

  if (candidates.length === 1) return { status: "ok", room: candidates[0] };
  if (source === "HALL") {
    const halls = candidates.filter((room) => String(room.source_room_number).toUpperCase() === "HALL");
    if (halls.length === 1) return { status: "ok", room: halls[0] };
  }
  if (candidates.length > 1) return { status: "ambiguous", room: null, candidates: candidates.map((room) => room.room_number) };
  return { status: "unmapped", room: null };
}

async function fetchAll(db, table, columns) {
  const pageSize = 1000;
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if ((data ?? []).length < pageSize) break;
  }
  return all;
}

function pickScored(scored, entry) {
  if (entry.mobile) {
    const byMobile = scored.filter((row) => digits(row.member.mobile) === entry.mobile);
    if (byMobile.length === 1 && byMobile[0].score >= 0.5) return byMobile[0];
  }
  const exact = scored.find((row) => row.score === 1);
  if (exact) return exact;
  if (!scored.length || scored[0].score < 0.7) return null;
  if (scored.length > 1 && scored[0].score - scored[1].score < 0.08 && scored[1].score >= 0.7) return null;
  return scored[0];
}

function matchMember(entry, familiesByCode, membersByFamily, members, familyById) {
  const family = entry.code ? familiesByCode.get(entry.code) : null;
  const localMembers = family ? membersByFamily.get(family.id) ?? [] : members;
  const scored = localMembers
    .map((member) => {
      let score = nameScore(entry.name, member.name);
      if (family) {
        const excelFirst = tokensOf(entry.name)[0];
        const memberFirst = tokensOf(member.name)[0];
        if (excelFirst && closeToken(excelFirst, memberFirst)) score = Math.max(score, 0.86);
      }
      return { member, score };
    })
    .sort((left, right) => right.score - left.score);
  let picked = pickScored(scored, entry);

  if (!picked && family) {
    const global = members
      .map((member) => ({ member, score: nameScore(entry.name, member.name) }))
      .sort((left, right) => right.score - left.score);
    picked = pickScored(global, entry);
  }

  if (!picked && !family) {
    picked = pickScored(scored, entry);
  }

  if (!picked) {
    if (!family) return { status: "family_not_found", member: null, family: null };
    if (scored[0]?.score >= 0.7 && scored[1]?.score >= 0.7) {
      return { status: "member_ambiguous", member: null, family, options: scored.slice(0, 3).map((row) => row.member.name) };
    }
    return { status: "member_not_found", member: null, family };
  }

  const matchedFamily = familyById.get(picked.member.family_id) ?? family;
  return { status: "ok", member: picked.member, family: matchedFamily, score: picked.score };
}

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false }
});

const excelRows = parseExcel();
const families = await fetchAll(db, "families", "id, head_name, head_mobile, city, registration_code, registration_type, wants_stay");
const members = await fetchAll(db, "members", "id, name, mobile, family_id, gender, age");
const rooms = await fetchAll(
  db,
  "rooms",
  "id, room_number, venue_name, section_name, source_room_number, capacity, room_type, owner_type, linked_pothi_id"
);
const allocations = await fetchAll(db, "room_allocations", "id, member_id, family_id, room_id");

const familiesByCode = new Map(families.map((family) => [String(family.registration_code ?? "").toUpperCase(), family]));
const familyById = new Map(families.map((family) => [family.id, family]));
const membersByFamily = new Map();
for (const member of members) {
  const list = membersByFamily.get(member.family_id) ?? [];
  list.push(member);
  membersByFamily.set(member.family_id, list);
}
const allocationByMember = new Map(allocations.map((row) => [row.member_id, row]));
const roomById = new Map(rooms.map((room) => [room.id, room]));
const occupancy = new Map();
for (const row of allocations) occupancy.set(row.room_id, (occupancy.get(row.room_id) ?? 0) + 1);

const issues = [];
const planned = [];
const seen = new Set();

for (const entry of excelRows) {
  const key = `${entry.code}|${normalizeName(entry.name)}|${entry.roomLabel}`;
  if (seen.has(key)) {
    issues.push({ type: "duplicate_excel_row", ...entry });
    continue;
  }
  seen.add(key);

  if (isBhuj(entry.city)) {
    issues.push({ type: "skipped_bhuj_no_room", ...entry });
    continue;
  }

  const resolved = resolveRoom(entry.roomLabel, rooms);
  const matched = matchMember(entry, familiesByCode, membersByFamily, members, familyById);
  if (matched.family && isBhuj(matched.family.city)) {
    issues.push({ type: "skipped_bhuj_no_room", ...entry, dbName: matched.member?.name, dbCity: matched.family.city });
    continue;
  }

  if (resolved.status !== "ok") {
    issues.push({ type: `room_${resolved.status}`, ...entry, candidates: resolved.candidates ?? [] });
    continue;
  }
  if (matched.status !== "ok") {
    issues.push({ type: matched.status, ...entry, options: matched.options ?? [], familyCity: matched.family?.city ?? null });
    continue;
  }

  const existing = allocationByMember.get(matched.member.id);
  const existingRoom = existing ? roomById.get(existing.room_id) : null;
  planned.push({
    entry,
    member: matched.member,
    family: matched.family,
    room: resolved.room,
    existing,
    existingRoom,
    nameScore: matched.score
  });
}

const usedMembers = new Set();
const inserts = [];
const updates = [];
const alreadyOk = [];

for (const item of planned) {
  if (usedMembers.has(item.member.id)) {
    issues.push({ type: "same_member_two_rooms", ...item.entry, memberId: item.member.id });
    continue;
  }
  usedMembers.add(item.member.id);

  if (item.existing && item.existing.room_id === item.room.id) {
    alreadyOk.push(item);
    continue;
  }
  if (item.existing && item.existing.room_id !== item.room.id) {
    const codeMatches = item.entry.code && item.entry.code === String(item.family.registration_code ?? "").toUpperCase();
    if (!codeMatches) {
      issues.push({
        type: "existing_allocation_conflict",
        ...item.entry,
        dbName: item.member.name,
        currentRoom: item.existingRoom?.room_number,
        excelRoom: item.room.room_number
      });
      continue;
    }
    updates.push(item);
    occupancy.set(item.existing.room_id, Math.max(0, (occupancy.get(item.existing.room_id) ?? 0) - 1));
    occupancy.set(item.room.id, (occupancy.get(item.room.id) ?? 0) + 1);
    continue;
  }
  inserts.push(item);
  occupancy.set(item.room.id, (occupancy.get(item.room.id) ?? 0) + 1);
}

const overCapacity = [];
const plannedByRoom = new Map();
for (const item of [...inserts, ...updates, ...alreadyOk]) {
  const list = plannedByRoom.get(item.room.id) ?? [];
  list.push(item);
  plannedByRoom.set(item.room.id, list);
}
for (const [roomId, count] of occupancy.entries()) {
  const room = roomById.get(roomId);
  if (room && count > room.capacity) {
    overCapacity.push({
      room: room.room_number,
      capacity: room.capacity,
      occupancy: count,
      fromExcel: (plannedByRoom.get(roomId) ?? []).length
    });
  }
}

const summary = {
  apply: APPLY,
  excelRows: excelRows.length,
  matchedToAllocate: inserts.length,
  matchedToMove: updates.length,
  alreadyAllocatedCorrectly: alreadyOk.length,
  issues: issues.length,
  issueCounts: issues.reduce((acc, issue) => {
    acc[issue.type] = (acc[issue.type] || 0) + 1;
    return acc;
  }, {}),
  overCapacity,
  moves: updates.map((item) => ({
    name: item.entry.name,
    from: item.existingRoom?.room_number,
    to: item.room.room_number
  })),
  unmatchedNoCode: issues
    .filter((issue) => issue.type === "family_not_found" && !issue.code)
    .map((issue) => `${issue.name} -> ${issue.roomLabel}`),
  pending: issues.filter((issue) => issue.type === "room_pending").map((issue) => issue.name),
  ambiguousRooms: issues.filter((issue) => issue.type === "room_ambiguous").map((issue) => `${issue.name} -> ${issue.roomLabel}`),
  unmappedRooms: issues.filter((issue) => issue.type === "room_unmapped").map((issue) => `${issue.name} -> ${issue.roomLabel}`),
  missingFamilies: [...new Set(issues.filter((issue) => issue.type === "family_not_found").map((issue) => issue.code))],
  missingMembers: issues.filter((issue) => issue.type === "member_not_found").map((issue) => `${issue.name} / ${issue.code}`),
  ambiguousMembers: issues.filter((issue) => issue.type === "member_ambiguous").map((issue) => `${issue.name} / ${issue.code} options:${(issue.options || []).join("|")}`)
};

console.log(JSON.stringify(summary, null, 2));

if (!APPLY) process.exit(0);

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

console.log(JSON.stringify({ inserted: inserts.length, moved: updates.length, familiesStayOn: familyIds.length }));
