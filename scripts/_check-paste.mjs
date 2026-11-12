import fs from "node:fs";
const target = new URL("./_allotment-paste-raw.txt", import.meta.url);
console.log("exists", fs.existsSync(target), "size", fs.existsSync(target) ? fs.statSync(target).size : 0);
