import { handleOptions, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

type CancelInput = {
  familyId?: string;
  registrationCode?: string;
  headMobile?: string;
};

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

    if (body.headMobile && family.head_mobile !== body.headMobile) {
      return json({ error: "Mobile number does not match this registration." }, 403);
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
    return json({ error: error instanceof Error ? error.message : "Cancellation failed." }, 500);
  }
});
