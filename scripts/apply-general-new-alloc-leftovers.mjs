/**
 * Retry leftover General Alloted "New Allocation" rows with looser matching.
 *
 * Usage:
 *   node --env-file=.env.local scripts/apply-general-new-alloc-leftovers.mjs
 *   node --env-file=.env.local scripts/apply-general-new-alloc-leftovers.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKBOOK = "C:/Users/DELL/Downloads/General Alloted - Copy.xlsx";
const REPORT = path.join(ROOT, "scripts", "_general-new-alloc-report.json");

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
  if (left.length >= 3 && right.length >= 3 && (left.startsWith(right.slice(0, 3)) || right.startsWith(left.slice(0, 3)))) {
    return true;
  }
  if (left.slice(1) === right.slice(1) && left.length >= 4) return true;
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
  if (firstClose && lastClose) return 0.92;
  if (firstClose) return 0.7;
  if (lastClose) return 0.62;
  const overlap = rightTokens.filter((part) => leftTokens.some((token) => closeToken(token, part))).length;
  if (!overlap) return 0;
  return (overlap / Math.max(leftTokens.length, rightTokens.length)) * 0.75;
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
  if (/DOUBLE\s*-?\s*CANCEL|CANCEL|REMOVE|DELETE/.test(upper)) return { action: "remove", label: upper };
  if (/^PRIVATE(\s*HOTEL|\s*ROOM)?$/.test(upper)) return { action: "assign", label: "PRIVATE HOTEL" };
  if (/LOHANA/.test(upper)) return { action: "assign", label: "LOHANA VADI" };
  if (/SHYAM\s*VILLA/.test(upper)) return { action: "assign", label: "SHYAM VILLA" };

  text = text
    .replace(/\bBV\b/gi, "BHUJ VIEW")
    .replace(/\bBHUJVIEW\b/gi, "BHUJ VIEW");

  const spaced = text.match(/^([A-Za-z. ]+?)\s+(\d+[A-Za-z]?)$/);
  if (spaced) {
    const venue = spaced[1].trim().toUpperCase();
    const num = spaced[2].trim();
    if (/JAKH/.test(venue)) return { action: "assign", label: `${num}/JAKHIBAI` };
    if (/RAJGOR/.test(venue)) return { action: "assign", label: `RAJGOR/${num}` };
    if (/MARU/.test(venue)) return { action: "assign", label: `MARU/${num}` };
    if (/BHUJ|BV/.test(venue)) return { action: "assign", label: `${num}/BHUJVIEW` };
    if (/NAVNEET/.test(venue) && /HALL/.test(venue)) {
      return { action: "assign", label: /FF|FIRST/.test(venue) ? "NAVNEET HALL FF" : "NAVNEET HALL GF" };
    }
    if (/NAVNEET/.test(venue)) return { action: "assign", label: `${num}/NAVNEET` };
    if (/^VSC$/.test(venue)) return { action: "assign", label: `VSC/${num.length === 1 ? `0${num}` : num}` };
    if (/SPM/.test(venue) && /HALL/.test(venue)) {
      return { action: "assign", label: /FF|FIRST/.test(venue) ? "SPM HALL FF" : "SPM HALL GF" };
    }
    if (/SPM/.test(venue)) return { action: "assign", label: `SPM/${num}` };
    return { action: "assign", label: `${venue}/${num}` };
  }

  if (/SPM\s*FF\s*HALL/i.test(text)) return { action: "assign", label: "SPM HALL FF" };
  if (/SPM\s*GF\s*HALL/i.test(text)) return { action: "assign", label: "SPM HALL GF" };
  if (/VALIBEN/i.test(text)) return { action: "assign", label: text };
  return { action: "assign", label: text };
}

function sectionHint(label) {
  const text = compact(label);
  if (text.includes("LOHANA")) return "LOHANA VADI";
  if (text.includes("SHYAM")) return "SHYAM VILLA";
  if (text.includes("JAKH")) return "JAKHIBAI";
  if (text.includes("MARU")) return "MARU COMPLEX";
  if (text.includes("NAVNEETHALL") || (text.includes("NAVNEET") && text.includes("HALL"))) return "NAVNEET HALL";
  if (text.includes("NAVNEET")) return "NAVNEET COMPLEX";
  if (text.includes("BHUJVIEW") || text.includes("BHUJ")) return "BHUJ VIEW HOTEL";
  if (text.includes("RAJGOR")) return "RAJGOR";
  if (text.includes("PRIVATE")) return "PRIVATE HOTEL";
  if (text.includes("VALIB")) return "VALIBEN HALL";
  if (text === "VSC" || text.startsWith("VSC")) return "VSC";
  if (text.includes("SPM")) return "S.P.M.COMPLEX";
  return null;
}

function resolveRoom(label, rooms) {
  const raw = String(label ?? "").trim();
  if (!raw) return { status: "blank", room: null };
  const upper = raw.toUpperCase().replace(/\s+/g, " ").trim();

  let source = null;
  let hint = sectionHint(upper);
  let floor = null;
  if (/\bG\.?F\.?\b|GROUND/.test(upper)) floor = "GF";
  else if (/\bF\.?F\.?\b|FIRST/.test(upper)) floor = "FF";

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
  } else if (/HALL|PRIVATE|LOHANA|SHYAM|VALIB/i.test(upper)) {
    source = /PRIVATE/i.test(upper) ? "PRIVATE" : "HALL";
    hint = sectionHint(upper) || hint;
  }

  if (!hint && !source) return { status: "unmapped", room: null };

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
      (hintC.includes("SPM") && (section.includes("SPM") || roomNo.includes("SPM"))) ||
      (hintC.includes("BHUJVIEW") && (section.includes("BHUJ") || venue.includes("BHUJ") || roomNo.includes("BHUJ")));
    const matchesSource =
      !source ||
      String(room.source_room_number) === String(source) ||
      (source === "PRIVATE" && /PRIVATE/i.test(`${room.source_room_number}${room.room_number}`));
    const matchesFloor = !floor || compact(room.floor) === floor || roomNo.endsWith(floor);
    return matchesHint && matchesSource && matchesFloor;
  });

  if (candidates.length === 1) return { status: "ok", room: candidates[0] };
  if (source === "HALL" || source === "PRIVATE") {
    const halls = candidates.filter((room) => {
      const src = String(room.source_room_number).toUpperCase();
      return src === "HALL" || src === "PRIVATE" || /HALL|PRIVATE|LOHANA|SHYAM/i.test(room.room_number);
    });
    if (halls.length === 1) return { status: "ok", room: halls[0] };
    if (hint) {
      const exact = halls.filter((room) => {
        const h = compact(hint);
        return compact(room.section_name).includes(h) || compact(room.venue_name).includes(h) || compact(room.room_number).includes(h);
      });
      if (exact.length === 1) return { status: "ok", room: exact[0] };
    }
  }
  if (candidates.length > 1) {
    return { status: "ambiguous", room: null, candidates: candidates.map((r) => r.room_number) };
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
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw new Error(`${label} failed: ${lastError?.message || lastError}`);
}

const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
const leftoverNames = new Set(
  (report.issues || []).map((issue) => normalizeName(issue.name)).filter(Boolean)
);

const workbook = XLSX.readFile(WORKBOOK);
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
const entries = rows
  .map((row, index) => {
    const newRaw = String(row["New Allocation"] ?? "").trim();
    if (!newRaw) return null;
    const name = String(row["Member name"] ?? row["Member Name"] ?? "").trim();
    if (!leftoverNames.has(normalizeName(name))) return null;
    return {
      rowIndex: index + 2,
      name,
      mobile: digits(row["Member mobile"] ?? row["Member Mobile"]),
      code: String(row["Registration code"] ?? row["Registration Code"] ?? "")
        .trim()
        .toUpperCase(),
      familyMobile: digits(row["Family mobile"] ?? row["Family Mobile"]),
      newRaw,
      ...normalizeNewAllocation(newRaw),
    };
  })
  .filter(Boolean);

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const families = await withRetry("families", () =>
  fetchAll(db, "families", "id, head_name, head_mobile, city, registration_code, wants_stay")
);
const members = await withRetry("members", () =>
  fetchAll(db, "members", "id, name, mobile, family_id")
);
const rooms = await withRetry("rooms", () =>
  fetchAll(
    db,
    "rooms",
    "id, room_number, venue_name, section_name, source_room_number, capacity, floor"
  )
);
const allocations = await withRetry("allocations", () =>
  fetchAll(db, "room_allocations", "id, member_id, family_id, room_id")
);

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

function matchLoose(entry) {
  if (entry.mobile && membersByMobile.has(entry.mobile)) {
    const hits = membersByMobile.get(entry.mobile);
    if (hits.length === 1) {
      return {
        status: "ok",
        member: hits[0],
        family: familyById.get(hits[0].family_id),
        score: Math.max(0.8, nameScore(entry.name, hits[0].name)),
      };
    }
  }

  const family = entry.code ? familiesByCode.get(entry.code) : null;
  if (family) {
    const local = (membersByFamily.get(family.id) ?? [])
      .map((member) => ({ member, score: nameScore(entry.name, member.name) }))
      .sort((a, b) => b.score - a.score);
    if (local[0] && local[0].score >= 0.45) {
      if (local.length > 1 && local[0].score - local[1].score < 0.05 && local[1].score >= 0.45) {
        // Prefer first-name match if tied
        const first = tokensOf(entry.name)[0];
        const byFirst = local.find((row) => closeToken(tokensOf(row.member.name)[0], first));
        if (byFirst) return { status: "ok", member: byFirst.member, family, score: byFirst.score };
      }
      return { status: "ok", member: local[0].member, family, score: local[0].score };
    }
    // Single-member family: allot that person even if names diverge a lot
    const only = membersByFamily.get(family.id) ?? [];
    if (only.length === 1) {
      return { status: "ok", member: only[0], family, score: Math.max(0.4, nameScore(entry.name, only[0].name)) };
    }
    return {
      status: "member_ambiguous",
      member: null,
      family,
      options: local.slice(0, 5).map((row) => `${row.member.name}:${row.score.toFixed(2)}`),
    };
  }

  if (entry.familyMobile) {
    const fams = families.filter((f) => digits(f.head_mobile) === entry.familyMobile);
    if (fams.length === 1) {
      const local = (membersByFamily.get(fams[0].id) ?? [])
        .map((member) => ({ member, score: nameScore(entry.name, member.name) }))
        .sort((a, b) => b.score - a.score);
      if (local[0]?.score >= 0.5) {
        return { status: "ok", member: local[0].member, family: fams[0], score: local[0].score };
      }
    }
  }

  return { status: "not_found", member: null, family: null };
}

const moves = [];
const inserts = [];
const removes = [];
const issues = [];
const alreadyOk = [];

for (const entry of entries) {
  const matched = matchLoose(entry);
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

  const resolved = resolveRoom(entry.label, rooms);
  if (resolved.status !== "ok") {
    issues.push({ type: `room_${resolved.status}`, ...entry, candidates: resolved.candidates ?? [] });
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
  if (existing) moves.push(item);
  else inserts.push(item);
}

const summary = {
  apply: APPLY,
  leftoverInput: entries.length,
  moves: moves.length,
  inserts: inserts.length,
  removes: removes.length,
  alreadyOk: alreadyOk.length,
  issues: issues.length,
  sampleMoves: moves.slice(0, 30).map((i) => ({
    name: i.entry.name,
    matchedAs: i.member.name,
    score: i.score,
    from: i.existingRoom?.room_number,
    to: i.room.room_number,
    newRaw: i.entry.newRaw,
  })),
  sampleInserts: inserts.slice(0, 20).map((i) => ({
    name: i.entry.name,
    matchedAs: i.member.name,
    score: i.score,
    to: i.room.room_number,
    newRaw: i.entry.newRaw,
  })),
  sampleRemoves: removes.map((i) => ({
    name: i.entry.name,
    matchedAs: i.member.name,
    from: i.existingRoom?.room_number,
    newRaw: i.entry.newRaw,
  })),
  stillMissing: issues.map((i) => `${i.name} / ${i.code || i.mobile} / ${i.newRaw} / ${i.type}`),
};

const outPath = path.join(ROOT, "scripts", "_general-new-alloc-leftovers-report.json");
fs.writeFileSync(outPath, JSON.stringify({ summary, issues, moves, inserts, removes }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`\nWrote ${outPath}`);

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

const familyIds = [...new Set([...inserts, ...moves].map((i) => i.family?.id).filter(Boolean))];
for (let i = 0; i < familyIds.length; i += 100) {
  const chunk = familyIds.slice(i, i + 100);
  await withRetry(`familiesStay:${i}`, () => db.from("families").update({ wants_stay: true }).in("id", chunk));
}

console.log(JSON.stringify({ inserted: inserts.length, moved: moves.length, removed: removes.length }));
