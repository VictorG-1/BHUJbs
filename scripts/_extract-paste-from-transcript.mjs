import fs from "node:fs";
import path from "node:path";

const src = path.resolve(
  "C:/Users/DELL/.cursor/projects/c-Users-DELL-Documents-New-project/agent-transcripts/2566bf21-373e-4960-8266-906aafe854a5/compaction/segment_004.md"
);
const out = path.resolve("c:/Users/DELL/Documents/New project/scripts/_allotment-paste-raw.txt");

const text = fs.readFileSync(src, "utf8");
const marker = "<user_query>\n1\tALPA Hitesh shah";
const start = text.indexOf(marker);
if (start < 0) {
  console.error("paste start not found");
  process.exit(1);
}
const bodyStart = start + "<user_query>\n".length;
const endMarker = "\n</user_query>";
const end = text.indexOf(endMarker, bodyStart);
if (end < 0) {
  console.error("paste end not found");
  process.exit(1);
}
const paste = text.slice(bodyStart, end).replace(/\r\n/g, "\n");
fs.writeFileSync(out, paste, "utf8");
console.log("wrote", out, "bytes", Buffer.byteLength(paste), "lines", paste.split("\n").length);
