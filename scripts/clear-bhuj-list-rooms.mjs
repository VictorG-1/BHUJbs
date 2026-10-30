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

function digits(value) {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0a80-\u0aff]+/g, " ")
    .trim();
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

const apply = process.argv.includes("--apply");
const workbook = XLSX.readFile(resolveWorkbook("C:/Users/DELL/Downloads/BHUJ GENERAL 30-10-2026.xlsx"));
const rows = XLSX.utils.sheet_to_json(workbook.Sheets.BHUJ, { header: 1, defval: null }).slice(1);
const list = rows
  .filter((row) => row.some((cell) => cell != null && String(cell).trim() !== ""))
  .map((row) => ({
    name: String(row[0] ?? "").trim(),
    mobile: digits(row[3]),
    familyMobile: digits(row[5]),
    city: String(row[6] ?? "").trim(),
    code: String(row[7] ?? "").trim().toUpperCase()
  }));

const codes = new Set(list.map((row) => row.code).filter(Boolean));
const names = new Set(list.map((row) => normalizeName(row.name)).filter(Boolean));
const mobiles = new Set(list.flatMap((row) => [row.mobile, row.familyMobile]).filter((value) => value.length === 10));

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false }
});

async function fetchAll(table, columns) {
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

const families = await fetchAll(
  "families",
  "id, head_name, head_mobile, city, registration_code, registration_type, wants_stay"
);
const members = await fetchAll("members", "id, name, mobile, family_id");
const allocations = await fetchAll("room_allocations", "id, member_id, family_id, room_id");

const familyById = new Map(families.map((family) => [family.id, family]));
const codesWithoutFamilies = [...codes].filter(
  (code) => !families.some((family) => String(family.registration_code ?? "").toUpperCase() === code)
);
const matchedFamiliesByCode = families.filter((family) => codes.has(String(family.registration_code ?? "").toUpperCase()));
const matchedMembers = members.filter((member) => {
  const family = familyById.get(member.family_id);
  const code = String(family?.registration_code ?? "").toUpperCase();
  return Boolean(code && codes.has(code));
});

const matchedMemberIds = new Set(matchedMembers.map((member) => member.id));
const matchedFamilyIds = [...new Set(matchedMembers.map((member) => member.family_id))];
const matchedAllocations = allocations.filter((row) => matchedMemberIds.has(row.member_id));
const stayFamilies = matchedFamilyIds
  .map((id) => familyById.get(id))
  .filter((family) => family?.wants_stay);

console.log(
  JSON.stringify(
    {
      apply,
      listRows: list.length,
      uniqueCodes: codes.size,
      unmatchedCodes: codesWithoutFamilies.length,
      matchedFamiliesByCode: matchedFamiliesByCode.length,
      matchedFamilies: matchedFamilyIds.length,
      matchedMembers: matchedMembers.length,
      allocatedNow: matchedAllocations.length,
      unmatchedCodeSample: codesWithoutFamilies.slice(0, 10),
      familiesWantingStay: stayFamilies.length,
      allocationSample: matchedAllocations.slice(0, 20).map((row) => {
        const member = matchedMembers.find((item) => item.id === row.member_id);
        const family = familyById.get(row.family_id);
        return {
          name: member?.name,
          code: family?.registration_code,
          type: family?.registration_type,
          city: family?.city
        };
      })
    },
    null,
    2
  )
);

if (!apply) process.exit(0);

if (matchedAllocations.length) {
  const ids = matchedAllocations.map((row) => row.id);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { error } = await db.from("room_allocations").delete().in("id", chunk);
    if (error) throw error;
  }
}

for (let i = 0; i < matchedFamilyIds.length; i += 200) {
  const chunk = matchedFamilyIds.slice(i, i + 200);
  const { error } = await db.from("families").update({ wants_stay: false }).in("id", chunk);
  if (error) throw error;
}

console.log(
  JSON.stringify({
    removedAllocations: matchedAllocations.length,
    familiesMarkedNoStay: matchedFamilyIds.length
  })
);
