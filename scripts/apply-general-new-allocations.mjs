/**
 * Apply "New Allocation" column from General Alloted workbook.
 *
 * Usage:
 *   node --env-file=.env.local scripts/apply-general-new-allocations.mjs
 *   node --env-file=.env.local scripts/apply-general-new-allocations.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKBOOK =
  process.env.GENERAL_ALLOTED_PATH ||
  "C:/Users/DELL/Downloads/General Alloted - Copy.xlsx";

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
  if (
    left.length >= 4 &&
    right.length >= 4 &&
    (left.startsWith(right.slice(0, 4)) || right.startsWith(left.slice(0, 4)))
  ) {
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

function normalizeNewAllocation(raw) {
  let text = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!text) return { action: "blank", label: "" };

  const upper = text.toUpperCase();
  if (/DOUBLE\s*-?\s*CANCEL|CANCEL|REMOVE|DELETE/.test(upper)) {
    return { action: "remove", label: upper };
  }
  if (/^PRIVATE(\s*HOTEL|\s*ROOM)?$/.test(upper)) {
    return { action: "private", label: "PRIVATE HOTEL" };
  }
  if (/LOHANA/.test(upper)) {
    return { action: "assign", label: "LOHANA VADI" };
  }
  if (/SHYAM\s*VILLA/.test(upper)) {
    return { action: "assign", label: "SHYAM VILLA" };
  }

  // Alias expansions
  text = text
    .replace(/\bBV\b/gi, "BHUJ VIEW")
    .replace(/\bBHUJVIEW\b/gi, "BHUJ VIEW")
    .replace(/\bSPM\s*HALL\s*FF\b/gi, "SPM COMPLEX HALL FF")
    .replace(/\bSPM\s*HALL\s*GF\b/gi, "SPM COMPLEX HALL GF")
    .replace(/\bSPM\s*HALL\b/gi, "SPM COMPLEX HALL");

  // "RAJGOR 106" / "JAKHIBAI 1108" / "BV 101" -> VENUE/number or number/VENUE
  const spaced = text.match(/^([A-Za-z. ]+?)\s+(\d+[A-Za-z]?)$/);
  if (spaced) {
    const venue = spaced[1].trim().toUpperCase();
    const num = spaced[2].trim();
    if (/JAKH/.test(venue)) return { action: "assign", label: `${num}/JAKHIBAI` };
    if (/RAJGOR/.test(venue)) return { action: "assign", label: `RAJGOR/${num}` };
    if (/MARU/.test(venue)) return { action: "assign", label: `MARU/${num}` };
    if (/BHUJ|BV/.test(venue)) return { action: "assign", label: `${num}/BHUJVIEW` };
    if (/SMRUTI/.test(venue)) return { action: "assign", label: `SMRUTI/${num}` };
    if (/ATITHI/.test(venue)) return { action: "assign", label: `ATITHI/${num}` };
    if (/NAVNEET/.test(venue) && /HALL/.test(venue)) {
      return { action: "assign", label: /FF|FIRST/.test(venue) ? "NAVNEET HALL FF" : "NAVNEET HALL GF" };
    }
    if (/NAVNEET/.test(venue)) return { action: "assign", label: `${num}/NAVNEET` };
    if (/^VBC$/.test(venue)) return { action: "assign", label: `VBC/${num}` };
    if (/^VSC$/.test(venue)) {
      const padded = num.length === 1 ? `0${num}` : num;
      return { action: "assign", label: `VSC/${padded}` };
    }
    if (/SPM/.test(venue)) return { action: "assign", label: `SPM/${num}` };
    if (/PANVALLABH|PANVAL/.test(venue)) return { action: "assign", label: `PANVALLABH/${num}` };
    return { action: "assign", label: `${venue}/${num}` };
  }

  return { action: "assign", label: text };
}

function sectionHint(label) {
  const text = compact(label);
  if (text.includes("LOHANA")) return "LOHANA VADI";
  if (text.includes("SHYAMVILLA") || text.includes("SHYAM")) return "SHYAM VILLA";
  if (text.includes("JAKH")) return "JAKHIBAI";
  if (text.includes("MARU")) return "MARU COMPLEX";
  if (text.includes("NAVNEETHALL") || (text.includes("NAVNEET") && text.includes("HALL"))) return "NAVNEET HALL";
  if (text.includes("NAVNEET")) return "NAVNEET COMPLEX";
  if (text.includes("BHUJVIEW") || text.includes("BHUJVIEWHOTEL") || text === "BV") return "BHUJ VIEW HOTEL";
  if (text.includes("SMRUTI")) return "SMRUTI HILLS HOTEL";
  if (text.includes("ATITHI")) return "ATITHI HOTEL";
  if (text.includes("VALIB")) return "VALIBEN HALL";
  if (text.includes("RATANBEN")) return "RATANBEN HALL";
  if (text.includes("PANVALLABH") || text.includes("PANVAL")) return "PANVALLABH";
  if (text.includes("RAJGOR")) return "RAJGOR";
  if (text === "VBC" || text.startsWith("VBC")) return "VBC";
  if (text === "VSC" || text.startsWith("VSC")) return "VSC";
  if (text.includes("SPM")) return "S.P.M.COMPLEX";
  if (text.includes("PRIVATE")) return "PRIVATE HOTEL";
  return null;
}

function resolveRoom(label, rooms) {
  const raw = String(label ?? "").trim();
  if (!raw) return { status: "blank", room: null };

  const upper = raw.toUpperCase().replace(/\s+/g, " ").trim();
  if (upper === "PENDING" || upper === "PENDING ALLOTMENT") return { status: "pending", room: null };

  let source = null;
  let hint = sectionHint(upper);
  let floor = null;
  if (/\bG\.?F\.?\b|GROUND/.test(upper)) floor = "GF";
  else if (/\bF\.?F\.?\b|FIRST/.test(upper)) floor = "FF";
  else if (/\bS\.?F\.?\b|SECOND/.test(upper)) floor = "SF";

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
  } else if (/HALL|VALIBAI|VALIBEN|RATANBEN|LOHANA|PRIVATE|SHYAM/i.test(upper)) {
    if (/PRIVATE/i.test(upper)) source = "PRIVATE";
    else if (/LOHANA|SHYAM/i.test(upper)) source = "HALL";
    else source = "HALL";
    hint = sectionHint(upper) || hint;
  }

  if (!hint && !source) {
    return { status: "unmapped", room: null };
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
      (hintC.includes("BHUJVIEW") && (section.includes("BHUJ") || venue.includes("BHUJ") || roomNo.includes("BHUJ"))) ||
      (hintC.includes("LOHANA") && (section.includes("LOHANA") || venue.includes("LOHANA") || roomNo.includes("LOHANA")));
    const matchesSource =
      !source ||
      String(room.source_room_number) === String(source) ||
      (source === "PRIVATE" && /PRIVATE/i.test(String(room.source_room_number) + room.room_number));
    const matchesFloor = !floor || compact(room.floor) === floor || roomNo.endsWith(floor);
    return matchesHint && matchesSource && matchesFloor;
  });

  if (candidates.length === 1) return { status: "ok", room: candidates[0] };
  if (source === "HALL" || source === "PRIVATE") {
    const halls = candidates.filter((room) => {
      const src = String(room.source_room_number).toUpperCase();
      return src === "HALL" || src === "PRIVATE" || /HALL|PRIVATE|LOHANA/i.test(room.room_number);
    });
    if (halls.length === 1) return { status: "ok", room: halls[0] };
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
      candidates: candidates.map((room) => room.room_number),
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

function matchMember(entry, familiesByCode, membersByFamily, members, familyById, membersByMobile) {
  if (entry.mobile && membersByMobile.has(entry.mobile)) {
    const mobileHits = membersByMobile.get(entry.mobile);
    if (mobileHits.length === 1) {
      const member = mobileHits[0];
      return {
        status: "ok",
        member,
        family: familyById.get(member.family_id) ?? null,
        score: Math.max(0.85, nameScore(entry.name, member.name)),
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

  let picked = scored[0]?.score >= 0.7 ? scored[0] : null;
  if (scored.length > 1 && picked && scored[1].score >= 0.7 && picked.score - scored[1].score < 0.08) {
    picked = null;
  }

  if (!picked) {
    return {
      status: family ? "member_not_found" : "family_not_found",
      member: null,
      family: family ?? null,
      options: scored.slice(0, 3).map((row) => row.member.name),
    };
  }

  return {
    status: "ok",
    member: picked.member,
    family: familyById.get(picked.member.family_id) ?? family,
    score: picked.score,
  };
}

if (!fs.existsSync(WORKBOOK)) throw new Error(`Missing workbook: ${WORKBOOK}`);

const workbook = XLSX.readFile(WORKBOOK);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

const entries = rows
  .map((row, index) => {
    const newRaw = String(row["New Allocation"] ?? "").trim();
    if (!newRaw) return null;
    const parsed = normalizeNewAllocation(newRaw);
    return {
      rowIndex: index + 2,
      name: String(row["Member name"] ?? row["Member Name"] ?? "").trim(),
      mobile: digits(row["Member mobile"] ?? row["Member Mobile"]),
      code: String(row["Registration code"] ?? row["Registration Code"] ?? "")
        .trim()
        .toUpperCase(),
      familyMobile: digits(row["Family mobile"] ?? row["Family Mobile"]),
      currentRoom: String(row["Room number"] ?? row["Room No"] ?? "").trim(),
      newRaw,
      ...parsed,
    };
  })
  .filter(Boolean);

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

async function ensureSpecialRooms() {
  const specials = [
    {
      room_number: "HOTEL / PRIVATE HOTEL",
      venue_name: "HOTEL",
      section_name: "PRIVATE HOTEL",
      source_room_number: "PRIVATE",
      floor: null,
      capacity: 50,
      room_type: "private_room",
      owner_type: "PRIVATE",
      allotment_note: "General New Allocation PRIVATE",
    },
    {
      room_number: "LOHANA VADI / LOHANA VADI / HALL",
      venue_name: "LOHANA VADI",
      section_name: "LOHANA VADI",
      source_room_number: "HALL",
      floor: null,
      capacity: 80,
      room_type: "general_room",
      owner_type: "SAMAJ",
      allotment_note: "General New Allocation LOHANA VADI",
    },
    {
      room_number: "SHYAM VILLA / SHYAM VILLA / HALL",
      venue_name: "SHYAM VILLA",
      section_name: "SHYAM VILLA",
      source_room_number: "HALL",
      floor: null,
      capacity: 40,
      room_type: "general_room",
      owner_type: "PRIVATE",
      allotment_note: "General New Allocation SHYAM VILLA",
    },
  ];

  for (const room of specials) {
    const { data: existing, error } = await db
      .from("rooms")
      .select("id, room_number")
      .eq("room_number", room.room_number)
      .maybeSingle();
    if (error) throw error;
    if (existing) continue;
    const { error: insertError } = await db.from("rooms").insert({
      room_number: room.room_number,
      venue_name: room.venue_name,
      section_name: room.section_name,
      source_room_number: room.source_room_number,
      floor: room.floor,
      capacity: room.capacity,
      bed_count: room.capacity,
      extra_count: 0,
      room_type: room.room_type,
      owner_type: room.owner_type,
      allotment_note: room.allotment_note,
      linked_pothi_id: null,
      ac_type: null,
      sort_order: 9000,
    });
    if (insertError) throw insertError;
    console.log(`Created room ${room.room_number}`);
  }
}

async function withRetry(label, fn, attempts = 6) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await fn();
      if (result?.error) throw result.error;
      return result;
    } catch (error) {
      lastError = error;
      console.error(`Retry ${attempt}/${attempts} for ${label}: ${error.message || error}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
  throw new Error(`${label} failed: ${lastError?.message || lastError}`);
}

await withRetry("ensureSpecialRooms", () => ensureSpecialRooms());

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

const issues = [];
const moves = [];
const inserts = [];
const removes = [];
const alreadyOk = [];
const privateMoves = [];

for (const entry of entries) {
  const matched = matchMember(entry, familiesByCode, membersByFamily, members, familyById, membersByMobile);
  if (matched.status !== "ok") {
    issues.push({ type: matched.status, ...entry, options: matched.options ?? [] });
    continue;
  }

  const existing = allocationByMember.get(matched.member.id) ?? null;
  const existingRoom = existing ? roomById.get(existing.room_id) : null;

  if (entry.action === "remove") {
    if (existing) removes.push({ entry, member: matched.member, family: matched.family, existing, existingRoom });
    else alreadyOk.push({ entry, note: "already_unallocated" });
    continue;
  }

  if (entry.action === "private") {
    entry.label = "PRIVATE HOTEL";
  }

  const resolved = resolveRoom(entry.label, rooms);
  if (resolved.status !== "ok") {
    issues.push({
      type: `room_${resolved.status}`,
      ...entry,
      candidates: resolved.candidates ?? [],
    });
    continue;
  }

  if (existing && existing.room_id === resolved.room.id) {
    alreadyOk.push({ entry, room: resolved.room.room_number });
    continue;
  }

  const item = {
    entry,
    member: matched.member,
    family: matched.family,
    room: resolved.room,
    existing,
    existingRoom,
    score: matched.score,
  };

  if (entry.action === "private") privateMoves.push(item);
  if (existing) moves.push(item);
  else inserts.push(item);
}

const summary = {
  apply: APPLY,
  workbook: WORKBOOK,
  excelNewAllocations: entries.length,
  moves: moves.length,
  inserts: inserts.length,
  removes: removes.length,
  alreadyOk: alreadyOk.length,
  privateMoves: privateMoves.length,
  issues: issues.length,
  issueCounts: issues.reduce((acc, issue) => {
    acc[issue.type] = (acc[issue.type] || 0) + 1;
    return acc;
  }, {}),
  sampleMoves: moves.slice(0, 40).map((item) => ({
    name: item.entry.name,
    from: item.existingRoom?.room_number ?? null,
    to: item.room.room_number,
    newRaw: item.entry.newRaw,
  })),
  sampleInserts: inserts.slice(0, 20).map((item) => ({
    name: item.entry.name,
    to: item.room.room_number,
    newRaw: item.entry.newRaw,
  })),
  sampleRemoves: removes.slice(0, 20).map((item) => ({
    name: item.entry.name,
    from: item.existingRoom?.room_number ?? null,
    newRaw: item.entry.newRaw,
  })),
  unmapped: issues.filter((i) => i.type.startsWith("room_")).map((i) => ({
    name: i.name,
    newRaw: i.newRaw,
    label: i.label,
    type: i.type,
    candidates: i.candidates ?? [],
  })),
  missingPeople: issues
    .filter((i) => i.type === "member_not_found" || i.type === "family_not_found")
    .map((i) => `${i.name} / ${i.code || i.mobile}`),
};

const outPath = path.join(ROOT, "scripts", "_general-new-alloc-report.json");
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      summary,
      issues,
      moves: moves.map((i) => ({
        name: i.entry.name,
        from: i.existingRoom?.room_number,
        to: i.room.room_number,
        memberId: i.member.id,
        allocationId: i.existing?.id,
        roomId: i.room.id,
      })),
      inserts: inserts.map((i) => ({
        name: i.entry.name,
        to: i.room.room_number,
        memberId: i.member.id,
        familyId: i.family.id,
        roomId: i.room.id,
      })),
      removes: removes.map((i) => ({
        name: i.entry.name,
        from: i.existingRoom?.room_number,
        memberId: i.member.id,
        allocationId: i.existing.id,
      })),
    },
    null,
    2
  )
);

console.log(JSON.stringify(summary, null, 2));
console.log(`\nWrote report: ${outPath}`);

if (!APPLY) process.exit(0);

for (const item of inserts) {
  await withRetry(`insert:${item.entry.name}`, () =>
    db.from("room_allocations").insert({
      room_id: item.room.id,
      member_id: item.member.id,
      family_id: item.family.id,
    })
  );
}

for (const item of moves) {
  await withRetry(`move:${item.entry.name}`, () =>
    db
      .from("room_allocations")
      .update({ room_id: item.room.id, family_id: item.family.id })
      .eq("id", item.existing.id)
  );
}

for (const item of removes) {
  await withRetry(`remove:${item.entry.name}`, () =>
    db.from("room_allocations").delete().eq("id", item.existing.id)
  );
}

const familyIds = [
  ...new Set(
    [...inserts, ...moves]
      .map((item) => item.family?.id)
      .filter(Boolean)
  ),
];
for (let i = 0; i < familyIds.length; i += 100) {
  const chunk = familyIds.slice(i, i + 100);
  await withRetry(`familiesStay:${i}`, () => db.from("families").update({ wants_stay: true }).in("id", chunk));
}

console.log(
  JSON.stringify({
    inserted: inserts.length,
    moved: moves.length,
    removed: removes.length,
    familiesStayOn: familyIds.length,
  })
);
