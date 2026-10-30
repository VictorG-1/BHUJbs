export type RoomLabelSource = {
  room_number?: string | null;
  venue_name?: string | null;
  section_name?: string | null;
  source_room_number?: string | null;
};

function compact(value: string | null | undefined) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

export function sourceRoomNumber(room: RoomLabelSource) {
  if (room.source_room_number) return String(room.source_room_number).trim();
  const parts = String(room.room_number ?? "").split("/").map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) ?? "";
}

export function shortVenue(room: RoomLabelSource) {
  const section = compact(room.section_name);
  const venue = compact(room.venue_name);
  const source = compact(sourceRoomNumber(room));
  const haystack = `${section}${venue}`;

  if (haystack.includes("JAKHIBAI") || haystack.includes("JAKHBAI")) return "JAKHIBAI";
  if (haystack.includes("MARU")) return "MARU";
  if (haystack.includes("PANVALLABH") || haystack.includes("PANVALLABHCOMPLEX")) return "PANVALLABH";
  if (haystack.includes("VALIB")) return "VALIBAI";
  if (haystack.includes("RATANBEN")) return "RATANBEN";
  if (haystack.includes("ZAVERBEN")) return "ZAVERBEN";
  if (haystack.includes("NAVNEET") && (section.includes("HALL") || source === "HALL")) return "NAVNEET HALL";
  if (haystack.includes("NAVNEET")) return "NAVNEET";
  if ((haystack.includes("SPM") || haystack.includes("SPMCOMPLEX")) && source === "HALL") return "SPM HALL";
  if (haystack.includes("SPM")) return "SPM";
  if (haystack.includes("BHUJVIEW")) return "BHUJVIEW";
  if (haystack.includes("SMRUTI")) return "SMRUTI";
  if (haystack.includes("ATITHI")) return "ATITHI";
  if (haystack.includes("RAJGOR")) return "RAJGOR";
  if (haystack.includes("VBC") || haystack.includes("VAGAD")) return "VBC";
  if (venue === "HOTEL") return String(room.section_name ?? "HOTEL").replace(/ HOTEL$/i, "");
  return String(room.section_name || room.venue_name || "").trim() || "Venue";
}

export function shortRoom(room: RoomLabelSource) {
  const venue = shortVenue(room);
  const source = sourceRoomNumber(room);
  if (!source || source.toUpperCase() === "HALL") return venue;
  if (["JAKHIBAI", "NAVNEET", "BHUJVIEW", "SMRUTI"].includes(venue)) return `${source}/${venue}`;
  return `${venue}/${source}`;
}
