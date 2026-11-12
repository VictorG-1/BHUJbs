import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "_allotment-paste-report.json"), "utf8"));
const paste = fs.readFileSync(path.join(ROOT, "scripts", "_allotment-paste-raw.txt"), "utf8");

const pendingNames = [];
for (const line of paste.split(/\n/)) {
  const cols = line.split("\t").map((c) => c.trim());
  if (!cols.some(Boolean)) continue;
  const hasRoom = cols.some((c) =>
    /\/|(PRIVATE(\s+(HOTEL|ROOM))?|HOME|VALIBAI|RATANBEN|SPM(\s+COMPLEX)?(\s+HALL)?)$/i.test(c)
  );
  if (hasRoom) continue;
  let name = cols[0];
  if (/^\d+$/.test(cols[0])) name = cols[1] || "";
  if (name) pendingNames.push(name);
}

const leftovers = {
  applied: {
    inserted: report.summary.matchedToAllocate,
    moved: report.summary.matchedToMove,
    alreadyOk: report.summary.alreadyAllocatedCorrectly,
  },
  issueCounts: report.summary.issueCounts,
  notInDb: (report.issues || [])
    .filter((i) => i.type === "family_not_found")
    .map((i) => ({ name: i.name, mobile: i.mobile || i.familyMobile || "", room: i.roomLabel, source: i.sourceFile })),
  duplicateRoomClaims: (report.issues || [])
    .filter((i) => i.type === "same_member_two_rooms")
    .map((i) => ({ name: i.name, mobile: i.mobile || "", room: i.roomLabel })),
  pastePendingNoRoomUnique: [...new Set(pendingNames)].sort((a, b) => a.localeCompare(b)),
  overCapacity: report.summary.overCapacity,
};

fs.writeFileSync(path.join(ROOT, "scripts", "_allotment-paste-leftovers.json"), JSON.stringify(leftovers, null, 2));
console.log(
  JSON.stringify(
    {
      applied: leftovers.applied,
      notInDb: leftovers.notInDb.length,
      duplicateRoomClaims: leftovers.duplicateRoomClaims.length,
      pastePendingNoRoomUnique: leftovers.pastePendingNoRoomUnique.length,
      overCapacityRooms: leftovers.overCapacity.length,
      sampleNotInDb: leftovers.notInDb.slice(0, 15),
      samplePending: leftovers.pastePendingNoRoomUnique.slice(0, 20),
    },
    null,
    2
  )
);
