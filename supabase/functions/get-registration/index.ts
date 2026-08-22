import { handleOptions, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

type LookupInput = { mobile?: string; verificationToken?: string };

function normalizeMobile(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
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

    if (!family) return json({ found: false }, 404);

    const { data: members, error: membersError } = await supabase
      .from("members")
      .select("id, name, age, gender, mobile, is_head")
      .eq("family_id", family.id)
      .order("created_at");
    if (membersError) throw membersError;

    const memberIds = (members ?? []).map((member) => member.id);
    const { data: allocations, error: allocationError } = await supabase
      .from("room_allocations")
      .select("member_id, rooms(room_number, venue_name, section_name, floor)")
      .in("member_id", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]);
    if (allocationError) throw allocationError;

    return json({
      found: true,
      family: { ...family, room_number: allocations?.[0]?.rooms?.room_number ?? null },
      members: (members ?? []).map(({ id, name }) => ({ id, name })),
      allocations: (allocations ?? []).map((allocation) => ({
        member_id: allocation.member_id,
        member_name: members?.find((member) => member.id === allocation.member_id)?.name ?? "Guest",
        room_number: allocation.rooms?.room_number ?? "",
        venue_name: allocation.rooms?.venue_name ?? null,
        section_name: allocation.rooms?.section_name ?? null,
        floor: allocation.rooms?.floor ?? null
      }))
    });
  } catch (error) {
    return json({ error: describeError(error) }, 500);
  }
});
