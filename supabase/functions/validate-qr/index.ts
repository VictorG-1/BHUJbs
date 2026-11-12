import { handleOptions, json } from "../_shared/cors.ts";
import { requireStaff } from "../_shared/auth.ts";

type MealType = "breakfast" | "lunch" | "dinner";
type Input = { payload?: string; scanType?: string; mealType?: string };

const MEALS: MealType[] = ["breakfast", "lunch", "dinner"];

function normalizeQr(raw: string) {
  return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function parseMealType(body: Input): MealType | null {
  const value = (body.mealType ?? body.scanType ?? "").toLowerCase().trim();
  if (MEALS.includes(value as MealType)) return value as MealType;
  return null;
}

/** Prefer printed card text; map legacy JSON QR to Name/Room lines when needed */
function extractLookupValue(payload: string): string {
  const normalized = normalizeQr(payload);
  if (!normalized.startsWith("{")) return normalized;
  try {
    const decoded = JSON.parse(normalized) as {
      event?: string;
      guest?: { name?: string; room?: string; family_code?: string };
    };
    if (decoded.event === "KMS-BHAGWAT-2026" && decoded.guest?.name) {
      const lines = [`Name: ${decoded.guest.name}`];
      if (decoded.guest.room) lines.push(`Room: ${decoded.guest.room}`);
      if (decoded.guest.family_code) lines.push(`Reg: ${decoded.guest.family_code}`);
      return lines.join("\n");
    }
  } catch {
    /* treat as plain text */
  }
  return normalized;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const auth = await requireStaff(req);
    if ("error" in auth) return auth.error;

    const body = (await req.json()) as Input;
    if (!body.payload?.trim()) return json({ error: "QR payload is required." }, 400);

    const mealType = parseMealType(body);
    if (!mealType) {
      return json({ error: "Choose Breakfast, Lunch, or Dinner." }, 400);
    }

    const lookup = extractLookupValue(body.payload);

    let { data: card, error: cardError } = await auth.supabase
      .from("meal_qr_codes")
      .select("id, qr_value, category, member_name, room, pothi, city, mobile, arrival_date, departure_date, reg_code")
      .eq("qr_value", lookup)
      .maybeSingle();
    if (cardError) throw cardError;

    // Fallback: Name + Room soft match (legacy JSON scans)
    if (!card && lookup.startsWith("Name:")) {
      const name = lookup.split("\n").find((l) => l.startsWith("Name:"))?.slice(5).trim();
      const room = lookup.split("\n").find((l) => l.startsWith("Room:"))?.slice(5).trim();
      if (name) {
        let query = auth.supabase
          .from("meal_qr_codes")
          .select("id, qr_value, category, member_name, room, pothi, city, mobile, arrival_date, departure_date, reg_code")
          .ilike("member_name", name)
          .limit(5);
        if (room) query = query.ilike("room", room);
        const { data: matches, error } = await query;
        if (error) throw error;
        card = matches?.[0] ?? null;
      }
    }

    if (!card) {
      return json({ error: "QR code not found. This card is not in the meal list." }, 404);
    }

    const todayIst = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const { data: previous, error: prevError } = await auth.supabase
      .from("meal_scans")
      .select("id, scanned_at")
      .eq("meal_qr_code_id", card.id)
      .eq("meal_type", mealType)
      .eq("scan_date", todayIst)
      .maybeSingle();
    if (prevError) throw prevError;

    let alreadyScanned = Boolean(previous);
    if (!previous) {
      const { error: insertError } = await auth.supabase.from("meal_scans").insert({
        meal_qr_code_id: card.id,
        meal_type: mealType,
        scanned_by: auth.user.id,
        scan_date: todayIst,
      });
      if (insertError) {
        if (insertError.code === "23505") alreadyScanned = true;
        else throw insertError;
      }
    }

    const mealLabel = mealType.charAt(0).toUpperCase() + mealType.slice(1);
    return json({
      alreadyScanned,
      mealType,
      member: {
        name: card.member_name || card.qr_value,
        room: card.room ?? "",
        venue: card.city ?? "",
        pothi: card.pothi ?? "",
        category: card.category ?? "",
        scanStatus: alreadyScanned
          ? `${mealLabel} already validated today`
          : `${mealLabel} validated`,
      },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "QR validation failed." }, 500);
  }
});
