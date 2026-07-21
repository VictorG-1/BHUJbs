const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const pothiWorkbookPath =
  process.argv[2] || "C:\\Users\\DELL\\Downloads\\૧૦-પોથીનું લીસ્ટ.xlsx";
const roomWorkbookPath =
  process.argv[3] || "C:\\Users\\DELL\\Downloads\\ALLOTMENT FOR APP.xlsx";
const outputDir = process.argv[4] || path.join(process.cwd(), "src", "data");

function normalizeText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parsePothis(workbookPath) {
  const workbook = XLSX.readFile(workbookPath, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null });

  return rows
    .filter((row) => Number.isFinite(Number(row[0])))
    .map((row) => ({
      id: Number(row[0]),
      primary_holder_name: normalizeText(row[1]),
      city: normalizeText(row[2]),
      co_holders: row.slice(3, 9).map(normalizeText).filter(Boolean),
      handover_name: normalizeText(row[10]),
      contact_name: normalizeText(row[11]),
      contact_mobile: normalizeText(row[12]),
      family_id: null
    }));
}

function findSectionLabel(rows, headerIndex, sheetName) {
  for (let index = headerIndex - 1; index >= 0; index -= 1) {
    const cell = normalizeText(rows[index]?.[1]);
    if (cell) return cell;
  }
  return sheetName;
}

function parseRooms(workbookPath) {
  const workbook = XLSX.readFile(workbookPath, { cellDates: false });
  const rooms = [];
  let sortOrder = 1;

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      defval: null
    });

    for (let index = 0; index < rows.length; index += 1) {
      const header = rows[index];
      if (!Array.isArray(header) || header[0] !== "Room No.") continue;

      const sectionName = findSectionLabel(rows, index, sheetName);
      const subHeader = rows[index + 1] || [];
      const hasAcColumn = header.some((cell) => normalizeText(cell) === "A.C./Non A.C.");
      const ownerIndex = header.findIndex((cell) => normalizeText(cell) === "Owner");
      const pothiIndex = header.findIndex((cell) => /pothi/i.test(String(cell || "")));
      const trailingIndex = Math.max(header.length, subHeader.length) - 1;

      for (let rowIndex = index + 2; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        if (!row || row.every((cell) => cell == null || cell === "")) continue;
        if (row[0] === "Room No.") break;
        if (typeof row[0] !== "number") {
          const marker = normalizeText(row[1]);
          if (marker && /COMPLEX|HOTEL|VILLA|VADI|R\.T\.O\./i.test(marker)) break;
          continue;
        }

        const sourceRoomNumber = String(row[0]).trim();
        const bedIndex = hasAcColumn ? 3 : 2;
        const extraIndex = bedIndex + 1;
        const totalIndex = bedIndex + 2;
        const ownerType = normalizeText(row[ownerIndex]) || "SAMAJ";
        const linkedPothiId = normalizeNumber(
          pothiIndex >= 0 ? row[pothiIndex] : null
        );
        const allotmentNote = normalizeText(
          pothiIndex >= 0 && pothiIndex < trailingIndex ? row[pothiIndex + 1] : row[trailingIndex]
        );

        rooms.push({
          room_number: `${sheetName} / ${sectionName} / ${sourceRoomNumber}`,
          venue_name: sheetName,
          section_name: sectionName,
          source_room_number: sourceRoomNumber,
          floor: normalizeText(row[1]),
          ac_type: hasAcColumn ? normalizeText(row[2]) : null,
          bed_count: normalizeNumber(row[bedIndex]),
          extra_count: normalizeNumber(row[extraIndex]),
          total_capacity: normalizeNumber(row[totalIndex]) || 4,
          owner_type: ownerType,
          linked_pothi_id: linkedPothiId && linkedPothiId > 0 ? linkedPothiId : null,
          allotment_note: allotmentNote,
          room_type: ownerType === "PRIVATE" ? "private_room" : "general_room",
          sort_order: sortOrder
        });
        sortOrder += 1;
      }
    }
  }

  return rooms;
}

function mapPothisToSamajRooms(pothis, rooms) {
  const primaryRoomByPothi = new Map();

  for (const room of rooms.filter((entry) => entry.owner_type === "SAMAJ" && entry.linked_pothi_id)) {
    if (!primaryRoomByPothi.has(room.linked_pothi_id)) {
      primaryRoomByPothi.set(room.linked_pothi_id, room);
      continue;
    }

    room.linked_pothi_id = null;
  }

  const assigned = new Set(primaryRoomByPothi.keys());
  const availableSamajRooms = rooms.filter(
    (room) => room.owner_type === "SAMAJ" && room.linked_pothi_id == null
  );

  for (const pothi of pothis) {
    if (assigned.has(pothi.id)) continue;
    const nextRoom = availableSamajRooms.shift();
    if (!nextRoom) break;
    nextRoom.linked_pothi_id = pothi.id;
    nextRoom.allotment_note = nextRoom.allotment_note || pothi.primary_holder_name;
    assigned.add(pothi.id);
  }

  for (const room of rooms) {
    if (room.owner_type === "PRIVATE") {
      room.room_type = "private_room";
    } else if (room.linked_pothi_id) {
      room.room_type = "pothi_room";
    } else {
      room.room_type = "general_room";
    }
  }
}

function ensureOutputDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
  ensureOutputDir(outputDir);
  const pothis = parsePothis(pothiWorkbookPath);
  const rooms = parseRooms(roomWorkbookPath);
  mapPothisToSamajRooms(pothis, rooms);

  fs.writeFileSync(
    path.join(outputDir, "pothis.json"),
    JSON.stringify(pothis, null, 2)
  );
  fs.writeFileSync(
    path.join(outputDir, "rooms.json"),
    JSON.stringify(rooms, null, 2)
  );

  console.log(`Wrote ${pothis.length} pothis and ${rooms.length} rooms to ${outputDir}`);
}

main();
