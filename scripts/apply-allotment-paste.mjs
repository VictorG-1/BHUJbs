/**
 * Sync room allotments from the user's pasted Done+Pending TSV
 * (scripts/_allotment-paste-raw.txt), with Excel Done/Pending+room as fallback.
 *
 * Usage:
 *   node --env-file=.env.local scripts/apply-allotment-paste.mjs
 *   node --env-file=.env.local scripts/apply-allotment-paste.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PASTE_PATH = path.join(ROOT, "scripts", "_allotment-paste-raw.txt");
const ALLOTMENT_XLSX =
  process.env.ALLOTMENT_DONE_PATH ||
  "C:/Users/DELL/Downloads/Allotment_Done_vs_Pending (1).xlsx";

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

function normalizeRoomLabel(raw) {
  let text = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  text = text
    .replace(/\bV\.?\s*B\.?\s*C\.?\b/gi, "VBC")
    .replace(/\bV\.?\s*S\.?\s*C\.?\b/gi, "VSC")
    .replace(/\bS\.?\s*P\.?\s*M\.?\b/gi, "SPM")
    .replace(/\bBHUJ\s*VIEW\b/gi, "BHUJVIEW")
    .replace(/\bSMRUTI\s*HILLS?\b/gi, "SMRUTI")
    .replace(/\bSMRUTIHOTEL\b/gi, "SMRUTI")
    .replace(/\bJAKHBAI\b/gi, "JAKHIBAI")
    .replace(/\bVALIBAI\b/gi, "VALIBAI")
    .replace(/\bPRIVATE\s+ROOM\b/gi, "PRIVATE HOTEL")
    .replace(/\bSPM\s+COMPLEX(\s+HALL)?\b/gi, "SPM COMPLEX HALL")
    .replace(/\bHOTEL\s+FERN\s+MADHAPAR\b/gi, "HOTEL FERN MADHAPAR");

  // Strip trailing source notes
  text = text.replace(/\s+(GENERAL_ENTRY|Registration list).*$/i, "").trim();

  // Normalize "VENUE/num" spacing and dots
  text = text.replace(/\s*\/\s*/g, "/");

  // VSC single digit pad
  const vsc = text.match(/^VSC\/(\d+)$/i);
  if (vsc && vsc[1].length === 1) text = `VSC/0${vsc[1]}`;

  // SHYAM VILLA/4|7 → hall (no numbered rooms in inventory)
  if (/^SHYAM\s*VILLA\/\d+$/i.test(text)) return "SHYAM VILLA";

  // Flip JAKHIBAI/1108 style already ok; ensure BHUJVIEW/103 stays
  return text;
}

function looksLikeRoom(value) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  if (/GENERAL_ENTRY|Registration list|name match|double allotment|not in registration/i.test(text)) {
    return false;
  }
  const upper = text.toUpperCase();
  if (
    /^(PRIVATE(\s+(HOTEL|ROOM))?|HOME|VALIBAI|VALIBEN|RATANBEN(\s+HALL)?|SPM(\s+COMPLEX)?(\s+HALL)?|LOHANA(\s+VADI)?|SHYAM\s+VILLA)$/i.test(
      text
    )
  ) {
    return true;
  }
  if (upper === "HOTEL FERN MADHAPAR") return true;
  if (/[A-Za-z].*\/.*\d|\d.*\/.*[A-Za-z]/.test(text)) return true;
  if (/^(VBC|VSC|MARU|SPM|JAKHIBAI|NAVNEET|BHUJVIEW|SMRUTI|RAJGOR|ATITHI)\//i.test(text)) return true;
  return false;
}

function sectionHint(label) {
  const text = compact(label);
  if (text === "HOME" || text.includes("HOME")) return "HOME";
  if (text.includes("FERN") || text.includes("MADHAPAR")) return "HOTEL FERN MADHAPAR";
  if (text.includes("LOHANA")) return "LOHANA VADI";
  if (text.includes("SHYAMVILLA") || text.includes("SHYAM")) return "SHYAM VILLA";
  if (text.includes("JAKH")) return "JAKHIBAI";
  if (text.includes("MARU")) return "MARU COMPLEX";
  if (text.includes("NAVNEETHALL") || (text.includes("NAVNEET") && text.includes("HALL"))) return "NAVNEET HALL";
  if (text.includes("NAVNEET")) return "NAVNEET COMPLEX";
  if (text.includes("BHUJVIEW") || text.includes("BHUJ")) return "BHUJ VIEW HOTEL";
  if (text.includes("SMRUTI")) return "SMRUTI HILLS HOTEL";
  if (text.includes("ATITHI")) return "ATITHI HOTEL";
  if (text.includes("VALIB")) return "VALIBEN HALL";
  if (text.includes("RATANBEN")) return "RATANBEN HALL";
  if (text.includes("PANVALLABH") || text.includes("PANVAL")) return "PANVALLABH";
  if (text.includes("RAJGOR")) return "RAJGOR";
  if (text === "VBC" || text.startsWith("VBC")) return "VBC";
  if (text === "VSC" || text.startsWith("VSC")) return "VSC";
  if (text.includes("PRIVATE")) return "PRIVATE HOTEL";
  if (text.includes("SPM")) return "S.P.M.COMPLEX";
  return null;
}

function resolveRoom(label, rooms) {
  const raw = normalizeRoomLabel(label);
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
    } else if (/^\d+[A-Za-z]?$/.test(right)) {
      source = right.replace(/[A-Za-z]/g, "");
      hint = sectionHint(left) || hint;
    } else {
      hint = sectionHint(left) || sectionHint(right) || hint;
    }
  } else if (/HALL|VALIBAI|VALIBEN|RATANBEN|PRIVATE|SHYAM|LOHANA|HOME|FERN/i.test(upper)) {
    if (/PRIVATE/i.test(upper)) source = "PRIVATE";
    else if (/HOME|FERN|LOHANA|SHYAM/i.test(upper)) source = "HALL";
    else source = "HALL";
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
      (hintC.includes("SPM") && (section.includes("SPM") || venue.includes("SPM") || roomNo.includes("SPM"))) ||
      (hintC.includes("SMRUTI") && (section.includes("SMRUTI") || venue.includes("SMRUTI"))) ||
      (hintC.includes("BHUJVIEW") && (section.includes("BHUJ") || venue.includes("BHUJ") || roomNo.includes("BHUJ"))) ||
      (hintC.includes("FERN") && (section.includes("FERN") || venue.includes("FERN") || roomNo.includes("FERN"))) ||
      (hintC.includes("HOME") && (section.includes("HOME") || venue.includes("HOME") || roomNo.includes("HOME"))) ||
      (hintC.includes("LOHANA") && (section.includes("LOHANA") || venue.includes("LOHANA"))) ||
      (hintC.includes("SHYAM") && (section.includes("SHYAM") || venue.includes("SHYAM"))) ||
      (hintC.includes("PRIVATE") && (section.includes("PRIVATE") || venue.includes("PRIVATE") || roomNo.includes("PRIVATE")));
    const matchesSource =
      !source ||
      String(room.source_room_number) === String(source) ||
      (source === "PRIVATE" && /PRIVATE/i.test(String(room.source_room_number) + room.room_number)) ||
      (source === "HALL" && /HALL|PRIVATE|HOME|FERN|LOHANA|SHYAM/i.test(String(room.source_room_number) + room.room_number));
    const matchesFloor = !floor || compact(room.floor) === floor || roomNo.endsWith(floor);
    return matchesHint && matchesSource && matchesFloor;
  });

  if (candidates.length === 1) return { status: "ok", room: candidates[0] };
  if (source === "HALL" || source === "PRIVATE") {
    const halls = candidates.filter((room) => {
      const src = String(room.source_room_number).toUpperCase();
      return src === "HALL" || src === "PRIVATE" || /HALL|PRIVATE|LOHANA|HOME|FERN|SHYAM/i.test(room.room_number);
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

  let picked = pickScored(scored, entry);

  if (!picked && family) {
    const global = members
      .map((member) => ({ member, score: nameScore(entry.name, member.name) }))
      .sort((left, right) => right.score - left.score);
    picked = pickScored(global, entry);
  }

  if (!picked) {
    if (!family && !entry.code) {
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
      // Global name-only high confidence
      const global = members
        .map((member) => ({ member, score: nameScore(entry.name, member.name) }))
        .sort((a, b) => b.score - a.score);
      picked = pickScored(global, entry);
      if (picked && picked.score >= 0.9) {
        return {
          status: "ok",
          member: picked.member,
          family: familyById.get(picked.member.family_id) ?? null,
          score: picked.score,
        };
      }
      return { status: "family_not_found", member: null, family: null };
    }
    if (family && scored[0]?.score >= 0.7 && scored[1]?.score >= 0.7) {
      return {
        status: "member_ambiguous",
        member: null,
        family,
        options: scored.slice(0, 3).map((row) => row.member.name),
      };
    }
    return { status: "member_not_found", member: null, family };
  }

  return {
    status: "ok",
    member: picked.member,
    family: familyById.get(picked.member.family_id) ?? family,
    score: picked.score,
  };
}

function parsePasteLine(line, lineNo) {
  const raw = String(line ?? "").replace(/\r$/, "");
  if (!raw.trim()) return null;
  const cols = raw.split("\t").map((c) => c.trim());
  if (!cols.some(Boolean)) return null;

  let roomIdx = -1;
  for (let i = cols.length - 1; i >= 0; i -= 1) {
    if (looksLikeRoom(cols[i])) {
      roomIdx = i;
      break;
    }
  }
  // Sometimes room is second-to-last and last is PRIVATE marker or empty notes
  if (roomIdx < 0) {
    for (let i = cols.length - 1; i >= 0; i -= 1) {
      const c = cols[i];
      if (/PRIVATE/i.test(c) && i > 0 && looksLikeRoom(cols[i - 1])) {
        roomIdx = i - 1;
        break;
      }
    }
  }

  let nameIdx = 0;
  if (/^\d+$/.test(cols[0])) nameIdx = 1;
  const name = cols[nameIdx] || "";
  if (!name || /^\d+$/.test(name)) return null;

  // Collect mobiles (10+ digit fields)
  const mobiles = [];
  for (let i = nameIdx + 1; i < cols.length; i += 1) {
    if (i === roomIdx) continue;
    const d = digits(cols[i]);
    if (d.length === 10) mobiles.push(d);
  }

  const roomLabel = roomIdx >= 0 ? normalizeRoomLabel(cols[roomIdx]) : "";
  return {
    sourceFile: "paste",
    rowIndex: lineNo,
    name,
    mobile: mobiles[0] || "",
    familyMobile: mobiles[1] || mobiles[0] || "",
    code: "",
    roomLabel,
    priority: roomLabel ? 10 : 0,
    pending: !roomLabel,
  };
}

function parsePaste(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\n/);
  const entries = [];
  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parsePasteLine(lines[i], i + 1);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

function parseExcelDoneAndPending(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const workbook = XLSX.readFile(filePath);
  const out = [];

  const done = workbook.Sheets["Allotment Done"];
  if (done) {
    const rows = XLSX.utils.sheet_to_json(done, { defval: "" });
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const name = String(row["Member Name"] ?? "").trim();
      const roomLabel = normalizeRoomLabel(row.ROOM);
      if (!name || !roomLabel) continue;
      out.push({
        sourceFile: "excel_done",
        rowIndex: i + 2,
        name,
        mobile: digits(row["Member Mobile"]),
        familyMobile: digits(row["Family Mobile"]),
        code: "",
        roomLabel,
        priority: 5,
        pending: false,
      });
    }
  }

  const pending = workbook.Sheets["Allotment Pending"];
  if (pending) {
    const rows = XLSX.utils.sheet_to_json(pending, { defval: "" });
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const name = String(row["Member Name"] ?? "").trim();
      const roomLabel = normalizeRoomLabel(row["ROOM NO"]);
      if (!name) continue;
      out.push({
        sourceFile: "excel_pending",
        rowIndex: i + 2,
        name,
        mobile: digits(row["Member Mobile"]),
        familyMobile: digits(row["Family Mobile"]),
        code: "",
        roomLabel,
        priority: roomLabel ? 6 : 0,
        pending: !roomLabel,
      });
    }
  }

  const sheet1 = workbook.Sheets.Sheet1;
  if (sheet1) {
    const rows = XLSX.utils.sheet_to_json(sheet1, { header: 1, defval: "" });
    for (let i = 0; i < rows.length; i += 1) {
      const cols = rows[i].map((c) => String(c ?? "").trim());
      let roomLabel = "";
      for (let j = cols.length - 1; j >= 0; j -= 1) {
        if (looksLikeRoom(cols[j])) {
          roomLabel = normalizeRoomLabel(cols[j]);
          break;
        }
      }
      let name = "";
      for (const col of cols) {
        if (col && !/^\d+$/.test(col) && !looksLikeRoom(col) && !/^\d{4}-/.test(col) && digits(col).length !== 10) {
          name = col;
          break;
        }
      }
      if (!name || !roomLabel) continue;
      const mobiles = cols.map(digits).filter((d) => d.length === 10);
      out.push({
        sourceFile: "excel_sheet1",
        rowIndex: i + 1,
        name,
        mobile: mobiles[0] || "",
        familyMobile: mobiles[1] || mobiles[0] || "",
        code: "",
        roomLabel,
        priority: 7,
        pending: false,
      });
    }
  }

  return out;
}

function dedupePreferLast(entries) {
  // Later / higher priority wins for same person key
  const sorted = [...entries].sort((a, b) => a.priority - b.priority || a.rowIndex - b.rowIndex);
  const byKey = new Map();
  for (const entry of sorted) {
    if (!entry.roomLabel) continue;
    const key =
      (entry.mobile && `mob:${entry.mobile}`) ||
      `name:${normalizeName(entry.name)}|fm:${entry.familyMobile || ""}`;
    byKey.set(key, entry);
  }
  return [...byKey.values()];
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

async function ensureSpecialRooms(db) {
  const specials = [
    {
      room_number: "HOTEL / PRIVATE HOTEL",
      venue_name: "HOTEL",
      section_name: "PRIVATE HOTEL",
      source_room_number: "PRIVATE",
      capacity: 200,
      room_type: "private_room",
      owner_type: "PRIVATE",
    },
    {
      room_number: "HOME / HOME / HALL",
      venue_name: "HOME",
      section_name: "HOME",
      source_room_number: "HALL",
      capacity: 50,
      room_type: "general_room",
      owner_type: "PRIVATE",
    },
    {
      room_number: "HOTEL FERN MADHAPAR / HOTEL FERN MADHAPAR / HALL",
      venue_name: "HOTEL FERN MADHAPAR",
      section_name: "HOTEL FERN MADHAPAR",
      source_room_number: "HALL",
      capacity: 40,
      room_type: "general_room",
      owner_type: "PRIVATE",
    },
    {
      room_number: "LOHANA VADI / LOHANA VADI / HALL",
      venue_name: "LOHANA VADI",
      section_name: "LOHANA VADI",
      source_room_number: "HALL",
      capacity: 80,
      room_type: "general_room",
      owner_type: "SAMAJ",
    },
    {
      room_number: "SHYAM VILLA / SHYAM VILLA / HALL",
      venue_name: "SHYAM VILLA",
      section_name: "SHYAM VILLA",
      source_room_number: "HALL",
      capacity: 40,
      room_type: "general_room",
      owner_type: "PRIVATE",
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
      floor: null,
      capacity: room.capacity,
      bed_count: room.capacity,
      extra_count: 0,
      room_type: room.room_type,
      owner_type: room.owner_type,
      allotment_note: "Paste allotment sync",
      linked_pothi_id: null,
      ac_type: null,
      sort_order: 9000,
    });
    if (insertError) throw insertError;
    console.log(`Created room ${room.room_number}`);
  }
}

if (!fs.existsSync(PASTE_PATH)) throw new Error(`Missing paste: ${PASTE_PATH}`);

const pasteEntries = parsePaste(PASTE_PATH);
const excelEntries = parseExcelDoneAndPending(ALLOTMENT_XLSX);
const pendingOnly = [...pasteEntries, ...excelEntries].filter((e) => e.pending || !e.roomLabel);
const assignable = dedupePreferLast([...excelEntries, ...pasteEntries]);

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

await withRetry("ensureSpecialRooms", () => ensureSpecialRooms(db));

const families = await fetchAll(
  db,
  "families",
  "id, head_name, head_mobile, city, registration_code, registration_type, wants_stay, pothi_id"
);
const members = await fetchAll(db, "members", "id, name, mobile, family_id, gender, age");
let rooms = await fetchAll(
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

for (const entry of assignable) {
  const resolved = resolveRoom(entry.roomLabel, rooms);
  const matched = matchMember(entry, familiesByCode, membersByFamily, members, familyById, membersByMobile);

  if (resolved.status === "pending" || resolved.status === "blank") {
    issues.push({ type: "room_blank", ...entry });
    continue;
  }
  if (resolved.status !== "ok") {
    issues.push({
      type: `room_${resolved.status}`,
      ...entry,
      candidates: resolved.candidates ?? [],
    });
    continue;
  }
  if (matched.status !== "ok") {
    issues.push({
      type: matched.status,
      ...entry,
      options: matched.options ?? [],
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
    nameScore: matched.score,
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
    overCapacity.push({ room: room.room_number, capacity: room.capacity, occupancy: count });
  }
}

const issueCounts = issues.reduce((acc, issue) => {
  acc[issue.type] = (acc[issue.type] || 0) + 1;
  return acc;
}, {});

const summary = {
  apply: APPLY,
  pasteLines: pasteEntries.length,
  pasteWithRoom: pasteEntries.filter((e) => e.roomLabel).length,
  pastePending: pasteEntries.filter((e) => !e.roomLabel).length,
  excelRows: excelEntries.length,
  assignableAfterDedupe: assignable.length,
  pendingSkipped: pendingOnly.filter((e) => !e.roomLabel).length,
  db: {
    families: families.length,
    members: members.length,
    rooms: rooms.length,
    allocations: allocations.length,
  },
  matchedToAllocate: inserts.length,
  matchedToMove: updates.length,
  alreadyAllocatedCorrectly: alreadyOk.length,
  issues: issues.length,
  issueCounts,
  overCapacity: overCapacity.slice(0, 40),
  sampleMoves: updates.slice(0, 30).map((item) => ({
    name: item.entry.name,
    from: item.existingRoom?.room_number,
    to: item.room.room_number,
    source: item.entry.sourceFile,
  })),
  sampleInserts: inserts.slice(0, 30).map((item) => ({
    name: item.entry.name,
    room: item.room.room_number,
    source: item.entry.sourceFile,
  })),
  unmappedRooms: [...new Set(issues.filter((i) => i.type === "room_unmapped").map((i) => i.roomLabel))].slice(0, 50),
  ambiguousRooms: [...new Set(issues.filter((i) => i.type === "room_ambiguous").map((i) => i.roomLabel))].slice(0, 40),
  missingMembers: issues
    .filter((i) => i.type === "member_not_found")
    .slice(0, 40)
    .map((i) => `${i.name} / ${i.mobile || i.familyMobile}`),
  missingFamilies: issues
    .filter((i) => i.type === "family_not_found")
    .slice(0, 40)
    .map((i) => `${i.name} / ${i.mobile || i.familyMobile} → ${i.roomLabel}`),
};

const outPath = path.join(ROOT, "scripts", "_allotment-paste-report.json");
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      summary,
      issues: issues.slice(0, 800),
      inserts: inserts.map((i) => ({
        name: i.entry.name,
        room: i.room.room_number,
        memberId: i.member.id,
        source: i.entry.sourceFile,
      })),
      updates: updates.map((i) => ({
        name: i.entry.name,
        from: i.existingRoom?.room_number,
        to: i.room.room_number,
        memberId: i.member.id,
        source: i.entry.sourceFile,
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

for (const item of updates) {
  await withRetry(`move:${item.entry.name}`, () =>
    db
      .from("room_allocations")
      .update({ room_id: item.room.id, family_id: item.family.id })
      .eq("id", item.existing.id)
  );
}

const familyIds = [...new Set([...inserts, ...updates].map((item) => item.family?.id).filter(Boolean))];
for (let i = 0; i < familyIds.length; i += 100) {
  const chunk = familyIds.slice(i, i + 100);
  await withRetry(`familiesStay:${i}`, () => db.from("families").update({ wants_stay: true }).in("id", chunk));
}

console.log(JSON.stringify({ inserted: inserts.length, moved: updates.length, familiesStayOn: familyIds.length }));
