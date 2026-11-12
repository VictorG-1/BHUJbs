import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function env(key) {
  const line = fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}=`));
  if (!line) throw new Error(key);
  return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

const url = env("SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
console.log("url", url);
const t0 = Date.now();
try {
  const response = await fetch(`${url}/rest/v1/rooms?select=id&limit=1`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    }
  });
  console.log("ok", response.status, await response.text(), "ms", Date.now() - t0);
} catch (error) {
  console.log("fail", error.cause?.code || error.message, "ms", Date.now() - t0);
}
