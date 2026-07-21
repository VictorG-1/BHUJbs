import { handleOptions } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const admin = await requireAdmin(req);
    if ("error" in admin) return admin.error;
    const { supabase } = admin;
    const { data, error } = await supabase
      .from("members")
      .select("id, name, age, gender, mobile, is_head, families(head_name, head_mobile, city, pothi_id, reference_pothi_id, registration_type, private_room_number), room_allocations(rooms(room_number))")
      .order("name");
    if (error) throw error;

    const headers = ["member_id", "name", "age", "gender", "mobile", "head_name", "head_mobile", "city", "registration_type", "pothi", "private_room", "room"];
    const rows = (data ?? []).map((row: any) => [
      row.id,
      row.name,
      row.age,
      row.gender,
      row.mobile,
      row.families?.head_name,
      row.families?.head_mobile,
      row.families?.city,
      row.families?.registration_type,
      row.families?.pothi_id ?? row.families?.reference_pothi_id,
      row.families?.private_room_number,
      row.room_allocations?.[0]?.rooms?.room_number
    ]);

    const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=bhagwat-saptah-guests.csv",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Export failed." }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
});
