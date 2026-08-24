import { handleOptions, json } from "../_shared/cors.ts";
import { requireStaff } from "../_shared/auth.ts";

type Input = { payload?: string; scanType?: "entry" | "lunch" | "dinner" };

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  try {
    const auth = await requireStaff(req);
    if ("error" in auth) return auth.error;
    const body = (await req.json()) as Input;
    if (!body.payload) return json({ error: "QR payload is required." }, 400);
    let decoded: { event?: string; member_id?: string; token?: string };
    try { decoded = JSON.parse(body.payload); } catch { return json({ error: "Invalid QR code." }, 400); }
    if (decoded.event !== "KMS-BHAGWAT-2026" || !decoded.member_id || !decoded.token) return json({ error: "This QR code is not for this event." }, 400);

    const { data: member, error } = await auth.supabase.from("members").select("id, name, qr_token, qr_revoked_at, families(head_name, registration_type), room_allocations(rooms(room_number, venue_name))").eq("id", decoded.member_id).eq("qr_token", decoded.token).maybeSingle();
    if (error) throw error;
    if (!member || member.qr_revoked_at) return json({ error: "QR code is invalid, revoked, or cancelled." }, 404);
    const scanType = body.scanType ?? "entry";
    const { data: previous } = await auth.supabase.from("qr_scans").select("id").eq("member_id", member.id).eq("scan_type", scanType).gte("scanned_at", new Date().toISOString().slice(0, 10)).limit(1).maybeSingle();
    if (!previous) {
      const { error: scanError } = await auth.supabase.from("qr_scans").insert({ member_id: member.id, scan_type: scanType, scanned_by: auth.user.id });
      if (scanError) throw scanError;
    }
    const allocation = Array.isArray(member.room_allocations) ? member.room_allocations[0] : member.room_allocations;
    const room = allocation?.rooms;
    return json({ alreadyScanned: Boolean(previous), member: { name: member.name, room: room?.room_number ?? "", venue: room?.venue_name ?? "", scanStatus: previous ? "Already scanned today" : "Entry recorded" } });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "QR validation failed." }, 500); }
});
