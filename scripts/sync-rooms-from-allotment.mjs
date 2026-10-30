import fs from "node:fs";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

function env(key) {
  const line = fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}=`));
  if (!line) throw new Error(`Missing ${key}`);
  return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

function normalizeText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function parsePothiId(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const text = String(value).trim().toUpperCase();
  if (!text || text === "G" || text === "NA" || text.includes("/")) return null;
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function compact(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function findSectionLabel(rows, headerIndex, sheetName) {
  for (let index = headerIndex - 1; index >= 0; index -= 1) {
    const cell = normalizeText(rows[index]?.[1]);
    if (cell) return cell;
  }
  return sheetName;
}

function parseAllotment(path) {
  const workbook = XLSX.readFile(path, { cellDates: false });
  const rooms = [];
  for (const sheetName of workbook.SheetNames) {
    if (sheetName === "GUEST") continue;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: false, defval: null });
    for (let index = 0; index < rows.length; index += 1) {
      const header = rows[index];
      if (!Array.isArray(header) || header[0] !== "Room No.") continue;
      const sectionName = findSectionLabel(rows, index, sheetName);
      const hasAcColumn = header.some((cell) => normalizeText(cell) === "A.C./Non A.C.");
      const ownerIndex = header.findIndex((cell) => normalizeText(cell) === "Owner");
      const pothiIndex = header.findIndex((cell) => /pothi/i.test(String(cell || "")));
      for (let rowIndex = index + 2; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        if (!row || row.every((cell) => cell == null || cell === "")) continue;
        if (row[0] === "Room No.") break;
        const source = row[0];
        const isHall = String(source).toUpperCase() === "HALL";
        if (typeof source !== "number" && !isHall) {
          const marker = normalizeText(row[1]);
          if (marker && /COMPLEX|HOTEL|VILLA|VADI|R\.T\.O\.|HALL/i.test(marker)) break;
          continue;
        }
        const bedIndex = hasAcColumn ? 3 : 2;
        const ownerType = (normalizeText(row[ownerIndex]) || "SAMAJ").toUpperCase();
        const linkedPothiId = parsePothiId(pothiIndex >= 0 ? row[pothiIndex] : null);
        rooms.push({
          sheetName,
          sectionName,
          source_room_number: String(source).trim(),
          floor: normalizeText(row[1]),
          ac_type: hasAcColumn ? normalizeText(row[2]) : null,
          bed_count: Number.isFinite(Number(row[bedIndex])) ? Number(row[bedIndex]) : null,
          extra_count: Number.isFinite(Number(row[bedIndex + 1])) ? Number(row[bedIndex + 1]) : null,
          capacity: Number(row[bedIndex + 2]) || Number(row[bedIndex]) || 4,
          owner_type: ownerType,
          linked_pothi_id: linkedPothiId,
          allotment_note: normalizeText(pothiIndex >= 0 ? row[pothiIndex + 1] : row[row.length - 1]),
          room_type: ownerType === "PRIVATE" ? "private_room" : linkedPothiId ? "pothi_room" : "general_room"
        });
      }
    }
  }
  return rooms;
}

function matchDbRoom(excelRoom, dbRooms) {
  const source = compact(excelRoom.source_room_number);
  const section = compact(excelRoom.sectionName);
  const sheet = compact(excelRoom.sheetName);
  const scored = dbRooms
    .filter((room) => compact(room.source_room_number) === source)
    .map((room) => {
      const dbSection = compact(room.section_name);
      const dbVenue = compact(room.venue_name);
      let score = 0;
      if (dbSection && section && (dbSection.includes(section.slice(0, 6)) || section.includes(dbSection.slice(0, 6)))) score += 5;
      if (source === "HALL") {
        const hallKeys = ["VALIB", "RATAN", "ZAVER", "NAVNEET", "SPM"];
        const excelKey = hallKeys.find((key) => section.includes(key));
        const dbKey = hallKeys.find((key) => dbSection.includes(key));
        if (!excelKey || excelKey !== dbKey) score = 0;
        else score += 4;
      }
      if (dbVenue === sheet || dbSection.includes(sheet) || sheet.includes(dbVenue)) score += 2;
      if (excelRoom.sheetName === "HOTEL" && dbVenue === "HOTEL") score += 2;
      return { room, score };
    })
    .filter((row) => row.score >= 5)
    .sort((left, right) => right.score - left.score);
  return scored[0]?.room ?? null;
}

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

const APPLY = process.argv.includes("--apply");
const workbookPath = resolveWorkbook("C:/Users/DELL/Desktop/BHAGWAT/ALLOTMENT FOR APP.xlsx");
const excelRooms = parseAllotment(workbookPath);
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const { data: dbRooms, error } = await db
  .from("rooms")
  .select("id, room_number, venue_name, section_name, source_room_number, capacity, owner_type, linked_pothi_id, allotment_note, room_type, floor, ac_type, bed_count, extra_count");
if (error) throw error;

const unmatched = [];
const updates = [];
for (const excelRoom of excelRooms) {
  const dbRoom = matchDbRoom(excelRoom, dbRooms ?? []);
  if (!dbRoom) {
    unmatched.push(`${excelRoom.sheetName} / ${excelRoom.sectionName} / ${excelRoom.source_room_number}`);
    continue;
  }
  updates.push({
    id: dbRoom.id,
    floor: excelRoom.floor,
    ac_type: excelRoom.ac_type,
    bed_count: excelRoom.bed_count,
    extra_count: excelRoom.extra_count,
    capacity: excelRoom.capacity,
    owner_type: excelRoom.owner_type,
    linked_pothi_id: excelRoom.linked_pothi_id,
    allotment_note: excelRoom.allotment_note,
    room_type: excelRoom.room_type
  });
}

console.log(JSON.stringify({ excelRooms: excelRooms.length, matched: updates.length, unmatched }, null, 2));
if (!APPLY) process.exit(0);

for (let i = 0; i < updates.length; i += 80) {
  const chunk = updates.slice(i, i + 80);
  for (const row of chunk) {
    const { id, ...payload } = row;
    const { error: updateError } = await db.from("rooms").update(payload).eq("id", id);
    if (updateError) throw updateError;
  }
}
console.log(JSON.stringify({ updated: updates.length }));
