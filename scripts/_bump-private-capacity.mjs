import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function env(key) {
  const line = fs
    .readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}=`));
  return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

async function withRetry(label, fn, attempts = 8) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await fn();
      if (result?.error) throw result.error;
      return result;
    } catch (error) {
      lastError = error;
      console.error(`Retry ${attempt}/${attempts} for ${label}: ${error.message || error}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
    }
  }
  throw new Error(`${label} failed: ${lastError?.message || lastError}`);
}

const { data: rooms } = await withRetry("list rooms", () =>
  db
    .from("rooms")
    .select("id, room_number, capacity, source_room_number, section_name, venue_name")
    .or(
      "room_number.ilike.%PRIVATE%,room_number.ilike.%SHYAM%,section_name.ilike.%SHYAM%,venue_name.ilike.%SHYAM%,room_number.ilike.%HOME%,room_number.ilike.%FERN%"
    )
);
console.log(JSON.stringify(rooms, null, 2));

for (const room of rooms ?? []) {
  if (/PRIVATE/i.test(room.room_number) && room.capacity < 200) {
    await withRetry(`bump:${room.room_number}`, () =>
      db.from("rooms").update({ capacity: 200, bed_count: 200 }).eq("id", room.id)
    );
    console.log("bumped", room.room_number, "-> 200");
  }
}
