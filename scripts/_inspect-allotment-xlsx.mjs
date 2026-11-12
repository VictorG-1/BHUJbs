import XLSX from "xlsx";
import path from "node:path";

const file = "C:/Users/DELL/Downloads/Allotment_Done_vs_Pending (1).xlsx";
const wb = XLSX.readFile(file);
for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "", raw: false });
  console.log("\n===", name, "rows=", rows.length, "===");
  if (rows[0]) console.log("cols:", Object.keys(rows[0]));
  if (rows[0]) console.log("sample0:", JSON.stringify(rows[0]));
  if (rows[1]) console.log("sample1:", JSON.stringify(rows[1]));
  const withRoom = rows.filter((r) => {
    const keys = Object.keys(r);
    const roomKey = keys.find((k) => /room|allot/i.test(k));
    return roomKey && String(r[roomKey] || "").trim();
  });
  console.log("withRoomGuess", withRoom.length);
}
