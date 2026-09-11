import { handleOptions, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

type CancelInput = {
  familyId?: string;
  registrationCode?: string;
  headMobile?: string;
  memberId?: string;
  verificationToken?: string;
};

function normalizeMobile(value: string) {
  return value.replace(/\D/g, "");
}

function describeError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    return [value.message, value.details, value.hint]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .map((part) => part.trim())
      .join(" ") || (typeof value.code === "string" ? `Database error ${value.code}.` : "Cancellation failed.");
  }
  return "Cancellation failed.";
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const body = (await req.json()) as CancelInput;
    if (!body.familyId && !body.registrationCode) {
      return json({ error: "Family id or registration code is required." }, 400);
    }

    const supabase = serviceClient();
    let query = supabase
      .from("families")
      .select("id, head_mobile, registration_code");

    if (body.familyId) {
      query = query.eq("id", body.familyId);
    } else {
      query = query.eq("registration_code", body.registrationCode);
    }

    const { data: family, error: familyError } = await query.maybeSingle();
    if (familyError) throw familyError;
    if (!family) return json({ error: "Registration not found." }, 404);

    if (body.headMobile && normalizeMobile(family.head_mobile) !== normalizeMobile(body.headMobile)) {
      return json({ error: "Mobile number does not match this registration." }, 403);
    }

    if (body.memberId) {
      if (!body.headMobile || !body.verificationToken) {
        return json({ error: "Verified mobile and session token are required for member cancellation." }, 403);
      }

      const { data: verification, error: verificationError } = await supabase
        .from("sms_otp_verifications")
        .select("mobile, verified_at, verification_token")
        .eq("mobile", normalizeMobile(body.headMobile))
        .eq("verification_token", body.verificationToken)
        .maybeSingle();
      if (verificationError) throw verificationError;
      if (!verification?.verified_at) return json({ error: "Your member session needs OTP verification again." }, 403);

      const { data: member, error: memberError } = await supabase
        .from("members")
        .select("id, is_head")
        .eq("id", body.memberId)
        .eq("family_id", family.id)
        .maybeSingle();

      if (memberError) throw memberError;
      if (!member) return json({ error: "Member is not part of this registration." }, 404);

      const { data: remainingMembers, error: remainingError } = await supabase
        .from("members")
        .select("id")
        .eq("family_id", family.id)
        .neq("id", body.memberId);
      if (remainingError) throw remainingError;

      if (member.is_head && (remainingMembers?.length ?? 0) > 0) {
        return json({ error: "The primary member cannot be cancelled individually. Cancel the full reservation instead." }, 409);
      }

      if (!member.is_head) {
        const { error: memberDeleteError } = await supabase.from("members").delete().eq("id", body.memberId);
        if (memberDeleteError) throw memberDeleteError;
        return json({ success: true, memberId: body.memberId, remainingMembers: remainingMembers?.length ?? 0 });
      }
      // If the primary member is the only member, continue into full cancellation below.
    }

    const { data: linkedPothis, error: pothiError } = await supabase
      .from("pothis")
      .select("id")
      .eq("family_id", family.id);

    if (pothiError) throw pothiError;

    const { error: deleteError } = await supabase
      .from("families")
      .delete()
      .eq("id", family.id);

    if (deleteError) throw deleteError;

    const pothiIds = (linkedPothis ?? []).map((pothi) => pothi.id);
    if (pothiIds.length) {
      const { error: unlockError } = await supabase
        .from("pothis")
        .update({ locked_at: null })
        .in("id", pothiIds);

      if (unlockError) throw unlockError;
    }

    return json({
      success: true,
      familyId: family.id,
      registrationCode: family.registration_code
    });
  } catch (error) {
    return json({ error: describeError(error) }, 500);
  }
});
