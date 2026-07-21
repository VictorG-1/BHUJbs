import { handleOptions, json } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { sendWhatsApp } from "../_shared/whatsapp.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const admin = await requireAdmin(req);
    if ("error" in admin) return admin.error;

    const body = await req.json();
    if (!body.mobile || !body.message) return json({ error: "mobile and message are required." }, 400);

    const result = await sendWhatsApp({ mobile: body.mobile, message: body.message });

    const supabase = serviceClient();
    await supabase.from("whatsapp_notifications").insert({
      family_id: body.familyId ?? null,
      member_id: body.memberId ?? null,
      mobile: body.mobile,
      template_name: body.templateName ?? "manual",
      payload: { message: body.message },
      status: "sent",
      provider_message_id: result.id,
      sent_at: new Date().toISOString()
    });

    return json({ sent: true, result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "WhatsApp send failed." }, 500);
  }
});
