/**
 * Import / replace all meal QR codes from Downloads/All_QR_Codes_2400.xlsx
 *
 * Usage:
 *   node scripts/import-meal-qr-codes.mjs
 *   node scripts/import-meal-qr-codes.mjs "C:\path\to\All_QR_Codes_2400.xlsx"
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local (or env).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const i = trimmed.indexOf("=");
    const key = trimmed.slice(0, i).trim();
    let val = trimmed.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

function normalizeQr(raw) {
  return String(raw ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function parseReg(qrValue) {
  const line = normalizeQr(qrValue).split("\n").find((l) => l.startsWith("Reg:"));
  return line ? line.slice(4).trim() : null;
}

async function loadXlsx(filePath) {
  let XLSX;
  try {
    XLSX = require("xlsx");
  } catch {
    const tempXlsx = path.join(process.env.TEMP || "/tmp", "xlsx-read", "node_modules", "xlsx");
    XLSX = require(tempXlsx);
  }
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet);
}

function rowToRecord(row) {
  const qrValue = normalizeQr(row["QR Value (what the QR contains)"]);
  if (!qrValue) return null;
  return {
    sr_no: row["Sr. No."] ?? null,
    category: row.Category ? String(row.Category) : null,
    member_name: row["Member Name"] ? String(row["Member Name"]) : null,
    room: row.Room != null && row.Room !== "" ? String(row.Room) : null,
    pothi: row.Pothi != null && row.Pothi !== "" ? String(row.Pothi) : null,
    city: row.City ? String(row.City) : null,
    mobile: row["Member Mobile"] != null && row["Member Mobile"] !== "" ? String(row["Member Mobile"]) : null,
    arrival_date: row["Arrival Date"] ? String(row["Arrival Date"]) : null,
    departure_date: row["Departure Date"] ? String(row["Departure Date"]) : null,
    reg_code: parseReg(qrValue),
    pdf_file: row["PDF File"] ? String(row["PDF File"]) : null,
    pdf_page: row["PDF Page"] != null ? Number(row["PDF Page"]) : null,
    qr_value: qrValue,
    updated_at: new Date().toISOString(),
  };
}

async function upsertBatch(url, key, rows) {
  const res = await fetch(`${url}/rest/v1/meal_qr_codes?on_conflict=qr_value`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upsert failed (${res.status}): ${text}`);
  }
}

async function main() {
  const xlsxPath =
    process.argv[2] ||
    path.join(process.env.USERPROFILE || "", "Downloads", "All_QR_Codes_2400.xlsx");

  if (!fs.existsSync(xlsxPath)) {
    console.error("Excel not found:", xlsxPath);
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (check .env.local)");
    process.exit(1);
  }

  console.log("Reading", xlsxPath);
  const rawRows = await loadXlsx(xlsxPath);
  const records = rawRows.map(rowToRecord).filter(Boolean);
  console.log(`Parsed ${records.length} QR codes`);

  // Unique by qr_value (last wins)
  const byValue = new Map();
  for (const row of records) byValue.set(row.qr_value, row);
  const unique = [...byValue.values()];
  console.log(`Unique QR values: ${unique.length}`);

  // Write local snapshot for reference / offline
  const outDir = path.join(root, "scripts", "data");
  fs.mkdirSync(outDir, { recursive: true });
  const snapshotPath = path.join(outDir, "meal-qr-codes.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(unique, null, 2));
  console.log("Wrote snapshot", snapshotPath);

  // Replace previous set: delete all then insert in batches
  console.log("Clearing previous meal_qr_codes...");
  const del = await fetch(`${url}/rest/v1/meal_qr_codes?id=not.is.null`, {
    method: "DELETE",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=minimal",
    },
  });
  if (!del.ok) {
    const text = await del.text();
    throw new Error(`Delete failed (${del.status}): ${text}`);
  }

  const batchSize = 200;
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    await upsertBatch(url, key, batch);
    console.log(`Inserted ${Math.min(i + batchSize, unique.length)} / ${unique.length}`);
  }

  console.log("Done. Meal QR codes updated for Breakfast / Lunch / Dinner validation.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
