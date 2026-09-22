import { handleOptions, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

type LookupInput = { mobile?: string; verificationToken?: string };

function normalizeMobile(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function describeError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "Could not load registration.";
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const body = (await req.json()) as LookupInput;
    if (!body.mobile || !body.verificationToken) return json({ error: "Verified mobile and OTP token are required." }, 400);

    const mobile = normalizeMobile(body.mobile);
    const supabase = serviceClient();
    const { data: verification, error: verificationError } = await supabase
      .from("sms_otp_verifications")
      .select("id, mobile, verified_at, consumed_at, verification_token")
      .eq("mobile", mobile)
      .eq("verification_token", body.verificationToken)
      .maybeSingle();

    if (verificationError) throw verificationError;
    if (!verification?.verified_at) return json({ error: "Please verify the mobile number with OTP first." }, 403);

    const { data: families, error: familyError } = await supabase
      .from("families")
      .select("id, registration_code, registration_type, head_name, head_mobile, city, stay_from, stay_to, pothi_id, reference_pothi_id, private_room_number")
      .order("created_at", { ascending: false });
    if (familyError) throw familyError;

    const candidate = (families ?? []).find((family) => normalizeMobile(family.head_mobile ?? "") === mobile);
    let family = candidate;
    if (!family) {
      const { data: memberMatch, error: memberError } = await supabase
        .from("members")
        .select("family_id")
        .eq("mobile", mobile)
        .limit(1)
        .maybeSingle();
      if (memberError) throw memberError;
      family = (families ?? []).find((entry) => entry.id === memberMatch?.family_id);
    }

    // Imported Pothi records can have a contact mobile that differs from the
    // family head mobile. Resolve the linked Pothi before treating the login
    // as a new registration.
    if (!family) {
      const { data: pothiMatch, error: pothiError } = await supabase
        .from("pothis")
        .select("id, family_id")
        .eq("contact_mobile", mobile)
        .limit(1)
        .maybeSingle();
      if (pothiError) throw pothiError;
      family = (families ?? []).find((entry) =>
        entry.pothi_id === pothiMatch?.id || entry.id === pothiMatch?.family_id
      );
    }

    if (!family) return json({ found: false }, 404);

    const { data: members, error: membersError } = await supabase
      .from("members")
      .select("id, name, age, gender, mobile, is_head, created_at, qr_token, event_date, arrival_date, departure_date")
      .eq("family_id", family.id)
      .order("created_at");
    if (membersError) throw membersError;

    const { data: allocations, error: allocationError } = await supabase
      .from("room_allocations")
      .select("member_id, rooms(room_number, venue_name, section_name, floor)")
      .eq("family_id", family.id);
    if (allocationError) throw allocationError;

    const normalizedAllocations = (allocations ?? []).map((allocation) => {
      const room = firstRelation(allocation.rooms);
      return {
        member_id: allocation.member_id,
        member_name: members?.find((member) => member.id === allocation.member_id)?.name ?? "Guest",
        room_number: room?.room_number ?? "",
        venue_name: room?.venue_name ?? null,
        section_name: room?.section_name ?? null,
        floor: room?.floor ?? null
      };
    });

    return json({
      found: true,
      family: { ...family, room_number: normalizedAllocations[0]?.room_number || null },
      members: (members ?? []).map(({ id, name, age, gender, mobile, is_head, created_at, qr_token, event_date, arrival_date, departure_date }) => ({ id, name, age, gender, mobile, is_head, created_at, qr_token, event_date, arrival_date, departure_date })),
      allocations: normalizedAllocations
    });
  } catch (error) {
    return json({ error: describeError(error) }, 500);
  }
});
