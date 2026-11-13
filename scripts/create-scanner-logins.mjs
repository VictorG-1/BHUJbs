/**
 * Create 30 meal-scanner staff logins (subadmin) in Supabase Auth + admin_profiles.
 *
 * Usage: node scripts/create-scanner-logins.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i);
  let v = line.slice(i + 1);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

const COUNT = Number(process.env.SCANNER_LOGIN_COUNT || 30);
const DOMAIN = process.env.SCANNER_LOGIN_DOMAIN || "bhagwat-scanner.local";
const PASSWORD = process.env.SCANNER_LOGIN_PASSWORD || "ScanMeal@2026";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const outDir = path.join(root, "scripts", "data");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "scanner-logins-30.csv");

const rows = [["#", "full_name", "email", "password", "role", "user_id", "status"]];

for (let n = 1; n <= COUNT; n += 1) {
  const num = String(n).padStart(2, "0");
  const email = `scanner${num}@${DOMAIN}`;
  const fullName = `Scanner Staff ${num}`;

  let userId = null;
  let status = "created";

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName, purpose: "meal-scanner" },
  });

  if (createError) {
    // If user already exists, look them up and ensure profile
    if (/already|registered|exists/i.test(createError.message)) {
      const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) throw listError;
      const existing = listed.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (!existing) {
        rows.push([n, fullName, email, PASSWORD, "subadmin", "", `error: ${createError.message}`]);
        console.error(email, createError.message);
        continue;
      }
      userId = existing.id;
      status = "exists";
      // Reset password so staff can use the shared password
      const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
        password: PASSWORD,
        email_confirm: true,
      });
      if (updateError) {
        status = `exists-password-error: ${updateError.message}`;
      } else {
        status = "exists-password-reset";
      }
    } else {
      rows.push([n, fullName, email, PASSWORD, "subadmin", "", `error: ${createError.message}`]);
      console.error(email, createError.message);
      continue;
    }
  } else {
    userId = created.user?.id ?? null;
  }

  if (!userId) {
    rows.push([n, fullName, email, PASSWORD, "subadmin", "", "error: no user id"]);
    continue;
  }

  const { error: profileError } = await admin.from("admin_profiles").upsert(
    { user_id: userId, full_name: fullName, role: "subadmin" },
    { onConflict: "user_id" },
  );
  if (profileError) {
    status = `${status}; profile-error: ${profileError.message}`;
  } else {
    status = `${status}; profile-ok`;
  }

  rows.push([n, fullName, email, PASSWORD, "subadmin", userId, status]);
  console.log(`${num} ${email} -> ${status}`);
}

const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")).join("\n");
fs.writeFileSync(outPath, csv, "utf8");
console.log(`\nWrote ${outPath}`);
console.log(`Password for all: ${PASSWORD}`);
console.log("Use these on /scanner (subadmin).");
