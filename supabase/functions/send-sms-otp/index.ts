import { handleOptions, json } from "../_shared/cors.ts";
import { sendSms } from "../_shared/sms.ts";
import { serviceClient } from "../_shared/supabase.ts";

type SendOtpInput = {
  mobile?: string;
  purpose?: "yajman" | "guest";
};

function normalizeMobile(mobile: string) {
  return mobile.replace(/\D/g, "");
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const body = (await req.json()) as SendOtpInput;
    if (!body.mobile) return json({ error: "mobile is required." }, 400);

    const mobile = normalizeMobile(body.mobile);
    if (mobile.length < 10) return json({ error: "Enter a valid mobile number." }, 400);

    const supabase = serviceClient();

    if (body.purpose === "yajman") {
      const { data: pothis, error: pothiError } = await supabase
        .from("pothis")
        .select("id, contact_mobile")
        .not("contact_mobile", "is", null);

      if (pothiError) throw pothiError;

      const pothi = pothis?.find((entry) => normalizeMobile(entry.contact_mobile ?? "") === mobile);
      if (!pothi) {
        return json({ error: "This mobile number is not mapped to any Pothi Yajman contact." }, 404);
      }
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = await sha256(`${mobile}:${otp}`);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase
      .from("sms_otp_verifications")
      .update({ consumed_at: new Date().toISOString() })
      .eq("mobile", mobile)
      .is("consumed_at", null);

    const { data: record, error: insertError } = await supabase
      .from("sms_otp_verifications")
      .insert({
        mobile,
        otp_hash: otpHash,
        expires_at: expiresAt
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    const message =
      body.purpose === "yajman"
        ? `Welcome to the KMS Bhuj, Bhagwat Saptah powered by SMSINDIAHU. Your OTP for Pothi Yajman login is ${otp}`
        : `Welcome to the KMS Bhuj, Bhagwat Saptah powered by SMSINDIAHU. Your OTP for guest registration is ${otp}`;
    await sendSms({ mobile, message });

    return json({
      requestId: record.id,
      expiresAt,
      sent: true
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "OTP send failed." }, 500);
  }
});
