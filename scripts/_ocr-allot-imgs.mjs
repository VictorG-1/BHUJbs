import fs from "node:fs";
import path from "node:path";
import { createWorker } from "tesseract.js";

const files = [
  "C:/Users/DELL/.cursor/projects/c-Users-DELL-Documents-New-project/assets/image-6dbec39a-458b-483e-92bc-953d246e9b84.jpg",
  "C:/Users/DELL/.cursor/projects/c-Users-DELL-Documents-New-project/assets/image-8ec2a68c-4725-442e-880c-5fe715abe02d.jpg",
];

const cropDirs = [
  "C:/Users/DELL/Documents/New project/scripts/_allot-img-crops2/image-6dbec39a-458b-483e-92bc-953d246e9b84",
  "C:/Users/DELL/Documents/New project/scripts/_allot-img-crops2/image-8ec2a68c-4725-442e-880c-5fe715abe02d",
];

const worker = await createWorker("eng");
const out = [];

for (const dir of cropDirs) {
  const parts = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jpg"))
    .sort();
  console.log("OCR", dir, parts.length, "parts");
  let text = "";
  for (const part of parts) {
    const file = path.join(dir, part);
    const result = await worker.recognize(file);
    text += `\n----- ${part} -----\n${result.data.text}\n`;
    console.log("done", part, "chars", result.data.text.length);
  }
  out.push({ dir, text });
}

await worker.terminate();
const outPath = "C:/Users/DELL/Documents/New project/scripts/_allot-ocr-text.txt";
fs.writeFileSync(
  outPath,
  out.map((row) => `\n========== ${row.dir} ==========\n${row.text}`).join("\n")
);
console.log("Wrote", outPath);
