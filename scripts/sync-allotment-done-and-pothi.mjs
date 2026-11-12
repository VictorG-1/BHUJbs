/**
 * Sync room allocations from:
 *  - Allotment_Done_vs_Pending (Allotment Done sheet)
 *  - Pothi Final List (All Members sheet)
 *
 * Usage:
 *   node scripts/sync-allotment-done-and-pothi.mjs
 *   node scripts/sync-allotment-done-and-pothi.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ALLOTMENT_DONE =
  process.env.ALLOTMENT_DONE_PATH ||
  "C:/Users/DELL/Downloads/Allotment_Done_vs_Pending (1).xlsx";
const POTHI_FINAL =
  process.env.POTHI_FINAL_PATH ||
  "C:/Users/DELL/Downloads/Pothi_Final_List_01-11-2026_Single_Sheet.xlsx";

function env(key) {
  const line = fs
    .readFileSync(path.join(ROOT, ".env.local"), "utf8")
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
  if (left.length >= 4 && right.length >= 4 && (left.startsWith(right.slice(0, 4)) || right.startsWith(left.slice(0, 4)))) {
    return true;
  }
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
  if (firstClose && lastClose) return 0.9;
  if (firstClose && leftTokens.length === 1) return 0.72;
  const overlap = rightTokens.filter((part) => leftTokens.some((token) => closeToken(token, part))).length;
  if (!overlap) return 0;
  return (overlap / Math.max(leftTokens.length, rightTokens.length)) * 0.8;
}

function compact(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function excelDateToIso(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30) + value * 86400000;
    return new Date(epoch).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const m = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
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
  if (text.includes("RATANBEN") || text === "RATANBENHALL") return "RATANBEN HALL";
  if (text.includes("PANVALLABH") || text.includes("PANVAL")) return "PANVALLABH";
  if (text.includes("RAJGOR")) return "RAJGOR";
  if (text === "VBC" || text.startsWith("VBC")) return "VBC";
  if (text === "VSC" || text.startsWith("VSC")) return "VSC";
  if (text === "SPMCOMPLEXHALL" || text === "SPMHALL" || text === "SPMCOMPLEX" || text === "SPMCOMPLEXHALL") {
    return "S.P.M.COMPLEX";
  }
  if (text.includes("SPM") || text.includes("SPM")) return "S.P.M.COMPLEX";
  return null;
}

function resolveRoom(label, rooms) {
  const raw = String(label ?? "").trim();
  if (!raw) return { status: "blank", room: null };

  const upper = raw.toUpperCase().replace(/\s+/g, " ").trim();
  if (upper === "PENDING" || upper === "PENDING ALLOTMENT") return { status: "pending", room: null };
  if (upper === "PRIVATE ROOM" || upper === "PRIVATE HOTEL") return { status: "private_skip", room: null };

  let source = null;
  let hint = sectionHint(upper);
  let floor = null;
  if (/\bG\.?F\.?\b|GROUND/.test(upper)) floor = "GF";
  else if (/\bF\.?F\.?\b|FIRST/.test(upper)) floor = "FF";
  else if (/\bS\.?F\.?\b|SECOND/.test(upper)) floor = "SF";

  // Formats: 1108/JAKHIBAI | JAKHIBAI/1108 | PANVALLABH/601 | VBC/221 | SPM/403 | MARU/211
  const slash = upper.match(/^([^/]+)\/([^/]+)$/);
  if (slash) {
    const left = slash[1].trim();
    const right = slash[2].trim();
    if (/^\d+$/.test(left)) {
      source = left;
      hint = sectionHint(right) || hint;
    } else if (/^\d+$/.test(right)) {
      source = right;
      hint = sectionHint(left) || hint;
    } else {
      hint = sectionHint(left) || sectionHint(right) || hint;
    }
  } else if (/HALL|VALIBAI|VALIBEN|RATANBEN|SPM COMPLEX/i.test(upper)) {
    source = "HALL";
    hint = sectionHint(upper) || hint;
  }

  const candidates = rooms.filter((room) => {
    const section = compact(room.section_name);
    const venue = compact(room.venue_name);
    const roomNo = compact(room.room_number);
    const hintC = compact(hint);
    const matchesHint =
      !hint ||
      section.includes(hintC) ||
      venue.includes(hintC) ||
      roomNo.includes(hintC) ||
      (hintC.includes("SPM") && (section.includes("SPM") || venue.includes("SPM") || roomNo.includes("SPM"))) ||
      (hintC.includes("SMRUTI") && (section.includes("SMRUTI") || venue.includes("SMRUTI"))) ||
      (hintC.includes("BHUJVIEW") && (section.includes("BHUJ") || venue.includes("BHUJ") || roomNo.includes("BHUJ")));
    const matchesSource = !source || String(room.source_room_number) === String(source);
    const matchesFloor = !floor || compact(room.floor) === floor || roomNo.endsWith(floor);
    return matchesHint && matchesSource && matchesFloor;
  });

  if (candidates.length === 1) return { status: "ok", room: candidates[0] };
  if (source === "HALL") {
    const halls = candidates.filter((room) => String(room.source_room_number).toUpperCase() === "HALL");
    if (halls.length === 1) return { status: "ok", room: halls[0] };
    // Prefer exact hall section match
    if (hint) {
      const exact = halls.filter((room) => {
        const section = compact(room.section_name);
        const venue = compact(room.venue_name);
        const h = compact(hint);
        return section.includes(h) || venue.includes(h) || compact(room.room_number).includes(h);
      });
      if (exact.length === 1) return { status: "ok", room: exact[0] };
    }
  }
  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      room: null,
      candidates: candidates.map((room) => room.room_number)
    };
  }
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

function matchMember(entry, familiesByCode, membersByFamily, members, familyById, membersByMobile) {
  if (entry.mobile && membersByMobile.has(entry.mobile)) {
    const mobileHits = membersByMobile.get(entry.mobile);
    if (mobileHits.length === 1) {
      const member = mobileHits[0];
      return {
        status: "ok",
        member,
        family: familyById.get(member.family_id) ?? null,
        score: Math.max(0.85, nameScore(entry.name, member.name))
      };
    }
  }

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
      if (entry.mobile && digits(member.mobile) === entry.mobile) score = Math.max(score, 0.92);
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

  if (!picked) {
    if (!family && !entry.code) {
      // Match by family mobile + name
      if (entry.familyMobile) {
        const fams = [...familyById.values()].filter((f) => digits(f.head_mobile) === entry.familyMobile);
        if (fams.length === 1) {
          const famMembers = membersByFamily.get(fams[0].id) ?? [];
          const local = famMembers
            .map((member) => ({ member, score: nameScore(entry.name, member.name) }))
            .sort((a, b) => b.score - a.score);
          picked = pickScored(local, entry);
          if (picked) {
            return { status: "ok", member: picked.member, family: fams[0], score: picked.score };
          }
        }
      }
      return { status: "family_not_found", member: null, family: null };
    }
    if (family && scored[0]?.score >= 0.7 && scored[1]?.score >= 0.7) {
      return {
        status: "member_ambiguous",
        member: null,
        family,
        options: scored.slice(0, 3).map((row) => row.member.name)
      };
    }
    return { status: "member_not_found", member: null, family };
  }

  const matchedFamily = familyById.get(picked.member.family_id) ?? family;
  return { status: "ok", member: picked.member, family: matchedFamily, score: picked.score };
}

function parseAllotmentDone(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets["Allotment Done"] || workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return rows
    .map((row, index) => ({
      sourceFile: "allotment_done",
      rowIndex: index + 2,
      name: String(row["Member Name"] ?? "").trim(),
      age: row.Age,
      gender: String(row.Gender ?? "").toLowerCase(),
      mobile: digits(row["Member Mobile"]),
      familyName: String(row["Family / Yajman"] ?? "").trim(),
      familyMobile: digits(row["Family Mobile"]),
      city: String(row.City ?? "").trim(),
      code: "",
      pothi: String(row.POTHI ?? "").trim(),
      roomLabel: String(row.ROOM ?? "").trim(),
      roomSource: String(row["Room Source"] ?? "").trim(),
      arrival: excelDateToIso(row["Arrival Date"]),
      departure: excelDateToIso(row["Departure Date"]),
      priority: 1
    }))
    .filter((row) => row.name && row.roomLabel);
}

function parsePothiFinal(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets["All Members"];
  if (!sheet) throw new Error("Missing 'All Members' sheet in Pothi Final List");
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return rows
    .map((row, index) => {
      const venue = String(row.Venue ?? "").trim();
      const roomNo = String(row["Room No"] ?? "").trim();
      let roomLabel = roomNo;
      if (roomNo && venue && !roomNo.includes("/") && !/HALL|PRIVATE|PENDING/i.test(roomNo)) {
        roomLabel = `${venue}/${roomNo}`;
      } else if (!roomNo && venue) {
        roomLabel = venue;
      }
      return {
        sourceFile: "pothi_final",
        rowIndex: index + 2,
        name: String(row["Member Name"] ?? "").trim(),
        age: row.Age,
        gender: String(row.Gender ?? "").toLowerCase(),
        mobile: digits(row["Member Mobile"]),
        familyName: String(row["Family / Yajman"] ?? "").trim(),
        familyMobile: digits(row["Family Mobile"]),
        city: String(row.City ?? "").trim(),
        code: String(row["Registration Code"] ?? "").trim().toUpperCase(),
        pothi: String(row.Pothi ?? "").trim(),
        roomLabel,
        roomSource: "POTHI_FINAL",
        arrival: excelDateToIso(row["Arrival Date"]),
        departure: excelDateToIso(row["Departure Date"]),
        priority: 2
      };
    })
    .filter((row) => row.name && row.roomLabel && !/PENDING/i.test(row.roomLabel));
}

function dedupeEntries(entries) {
  // Prefer pothi_final (has registration codes) over allotment_done for same person.
  const byKey = new Map();
  const sorted = [...entries].sort((a, b) => b.priority - a.priority);
  for (const entry of sorted) {
    const key =
      (entry.code && `code:${entry.code}|${normalizeName(entry.name)}`) ||
      (entry.mobile && `mob:${entry.mobile}`) ||
      `name:${normalizeName(entry.name)}|fm:${entry.familyMobile}|room:${compact(entry.roomLabel)}`;
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  return [...byKey.values()];
}

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false }
});

if (!fs.existsSync(ALLOTMENT_DONE)) throw new Error(`Missing file: ${ALLOTMENT_DONE}`);
if (!fs.existsSync(POTHI_FINAL)) throw new Error(`Missing file: ${POTHI_FINAL}`);

const allotmentEntries = parseAllotmentDone(ALLOTMENT_DONE);
const pothiEntries = parsePothiFinal(POTHI_FINAL);
const excelRows = dedupeEntries([...allotmentEntries, ...pothiEntries]);

const families = await fetchAll(
  db,
  "families",
  "id, head_name, head_mobile, city, registration_code, registration_type, wants_stay, pothi_id"
);
const members = await fetchAll(db, "members", "id, name, mobile, family_id, gender, age");
const rooms = await fetchAll(
  db,
  "rooms",
  "id, room_number, venue_name, section_name, source_room_number, capacity, room_type, owner_type, linked_pothi_id, floor"
);
const allocations = await fetchAll(db, "room_allocations", "id, member_id, family_id, room_id");

const familiesByCode = new Map(
  families.map((family) => [String(family.registration_code ?? "").toUpperCase(), family])
);
const familyById = new Map(families.map((family) => [family.id, family]));
const membersByFamily = new Map();
for (const member of members) {
  const list = membersByFamily.get(member.family_id) ?? [];
  list.push(member);
  membersByFamily.set(member.family_id, list);
}
const membersByMobile = new Map();
for (const member of members) {
  const mobile = digits(member.mobile);
  if (!mobile) continue;
  const list = membersByMobile.get(mobile) ?? [];
  list.push(member);
  membersByMobile.set(mobile, list);
}
const allocationByMember = new Map(allocations.map((row) => [row.member_id, row]));
const roomById = new Map(rooms.map((room) => [room.id, room]));
const occupancy = new Map();
for (const row of allocations) occupancy.set(row.room_id, (occupancy.get(row.room_id) ?? 0) + 1);

const issues = [];
const planned = [];
const seenMembers = new Set();

for (const entry of excelRows) {
  const resolved = resolveRoom(entry.roomLabel, rooms);
  const matched = matchMember(entry, familiesByCode, membersByFamily, members, familyById, membersByMobile);

  if (resolved.status === "private_skip") {
    issues.push({ type: "skipped_private_room", ...entry });
    continue;
  }
  if (resolved.status === "pending") {
    issues.push({ type: "room_pending", ...entry });
    continue;
  }
  if (resolved.status !== "ok") {
    issues.push({
      type: `room_${resolved.status}`,
      ...entry,
      candidates: resolved.candidates ?? []
    });
    continue;
  }
  if (matched.status !== "ok") {
    issues.push({
      type: matched.status,
      ...entry,
      options: matched.options ?? [],
      familyCity: matched.family?.city ?? null
    });
    continue;
  }

  if (seenMembers.has(matched.member.id)) {
    issues.push({ type: "same_member_two_rooms", ...entry, memberId: matched.member.id });
    continue;
  }
  seenMembers.add(matched.member.id);

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

const inserts = [];
const updates = [];
const alreadyOk = [];

for (const item of planned) {
  if (item.existing && item.existing.room_id === item.room.id) {
    alreadyOk.push(item);
    continue;
  }
  if (item.existing && item.existing.room_id !== item.room.id) {
    updates.push(item);
    occupancy.set(item.existing.room_id, Math.max(0, (occupancy.get(item.existing.room_id) ?? 0) - 1));
    occupancy.set(item.room.id, (occupancy.get(item.room.id) ?? 0) + 1);
    continue;
  }
  inserts.push(item);
  occupancy.set(item.room.id, (occupancy.get(item.room.id) ?? 0) + 1);
}

const overCapacity = [];
for (const [roomId, count] of occupancy.entries()) {
  const room = roomById.get(roomId);
  if (room && count > room.capacity) {
    overCapacity.push({
      room: room.room_number,
      capacity: room.capacity,
      occupancy: count
    });
  }
}

const issueCounts = issues.reduce((acc, issue) => {
  acc[issue.type] = (acc[issue.type] || 0) + 1;
  return acc;
}, {});

const summary = {
  apply: APPLY,
  files: { allotmentDone: ALLOTMENT_DONE, pothiFinal: POTHI_FINAL },
  excel: {
    allotmentDoneRows: allotmentEntries.length,
    pothiFinalRows: pothiEntries.length,
    afterDedupe: excelRows.length
  },
  db: { families: families.length, members: members.length, rooms: rooms.length, allocations: allocations.length },
  matchedToAllocate: inserts.length,
  matchedToMove: updates.length,
  alreadyAllocatedCorrectly: alreadyOk.length,
  issues: issues.length,
  issueCounts,
  overCapacity: overCapacity.slice(0, 40),
  sampleMoves: updates.slice(0, 25).map((item) => ({
    name: item.entry.name,
    from: item.existingRoom?.room_number,
    to: item.room.room_number,
    source: item.entry.sourceFile
  })),
  sampleInserts: inserts.slice(0, 25).map((item) => ({
    name: item.entry.name,
    room: item.room.room_number,
    source: item.entry.sourceFile,
    code: item.entry.code || null
  })),
  unmappedRooms: [...new Set(issues.filter((i) => i.type === "room_unmapped").map((i) => i.roomLabel))].slice(0, 40),
  ambiguousRooms: [...new Set(issues.filter((i) => i.type === "room_ambiguous").map((i) => i.roomLabel))].slice(0, 40),
  missingMembers: issues.filter((i) => i.type === "member_not_found").slice(0, 30).map((i) => `${i.name} / ${i.code || i.mobile}`),
  missingFamilies: issues.filter((i) => i.type === "family_not_found").slice(0, 30).map((i) => `${i.name} / ${i.code || i.mobile || i.familyMobile}`),
  privateSkipped: issueCounts.skipped_private_room || 0
};

const outPath = path.join(ROOT, "scripts", "_allotment-sync-report.json");
fs.writeFileSync(outPath, JSON.stringify({ summary, issues: issues.slice(0, 500), inserts: inserts.map((i) => ({ name: i.entry.name, room: i.room.room_number, memberId: i.member.id })), updates: updates.map((i) => ({ name: i.entry.name, from: i.existingRoom?.room_number, to: i.room.room_number, memberId: i.member.id })) }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`\nWrote report: ${outPath}`);

if (!APPLY) process.exit(0);

async function withRetry(label, fn, attempts = 5) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await fn();
      if (result?.error) throw result.error;
      return result;
    } catch (error) {
      lastError = error;
      const waitMs = attempt * 1500;
      console.error(`Retry ${attempt}/${attempts} for ${label}: ${error.message || error}`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw new Error(`${label} failed: ${lastError?.message || lastError}`);
}

for (const item of inserts) {
  await withRetry(`insert:${item.entry.name}`, () =>
    db.from("room_allocations").insert({
      room_id: item.room.id,
      member_id: item.member.id,
      family_id: item.family.id
    })
  );
}

for (const item of updates) {
  await withRetry(`move:${item.entry.name}`, () =>
    db
      .from("room_allocations")
      .update({ room_id: item.room.id, family_id: item.family.id })
      .eq("id", item.existing.id)
  );
}

const familyIds = [...new Set([...inserts, ...updates].map((item) => item.family.id).filter(Boolean))];
for (let i = 0; i < familyIds.length; i += 100) {
  const chunk = familyIds.slice(i, i + 100);
  await withRetry(`familiesStay:${i}`, () => db.from("families").update({ wants_stay: true }).in("id", chunk));
}

console.log(JSON.stringify({ inserted: inserts.length, moved: updates.length, familiesStayOn: familyIds.length }));
