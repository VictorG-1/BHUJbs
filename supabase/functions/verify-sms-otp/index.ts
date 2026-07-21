import { handleOptions, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

type VerifyOtpInput = {
  mobile?: string;
  requestId?: string;
  otp?: string;
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
    const body = (await req.json()) as VerifyOtpInput;
    if (!body.mobile || !body.requestId || !body.otp) {
      return json({ error: "mobile, requestId and otp are required." }, 400);
    }

    const mobile = normalizeMobile(body.mobile);
    const supabase = serviceClient();
    const { data: record, error: recordError } = await supabase
      .from("sms_otp_verifications")
      .select("id, mobile, otp_hash, expires_at, verified_at, consumed_at, attempts")
      .eq("id", body.requestId)
      .eq("mobile", mobile)
      .maybeSingle();

    if (recordError) throw recordError;
    if (!record) return json({ error: "OTP request not found." }, 404);
    if (record.consumed_at) return json({ error: "This OTP request is no longer active." }, 400);
    if (record.verified_at) return json({ error: "This OTP has already been verified." }, 400);
    if (new Date(record.expires_at).getTime() < Date.now()) {
      return json({ error: "OTP has expired. Please request a new one." }, 400);
    }
    if ((record.attempts ?? 0) >= 5) {
      return json({ error: "Too many incorrect attempts. Please request a new OTP." }, 429);
    }

    const otpHash = await sha256(`${mobile}:${body.otp}`);
    if (otpHash !== record.otp_hash) {
      await supabase
        .from("sms_otp_verifications")
        .update({ attempts: (record.attempts ?? 0) + 1 })
        .eq("id", record.id);

      return json({ error: "Incorrect OTP." }, 400);
    }

    const verificationToken = crypto.randomUUID();
    const { error: updateError } = await supabase
      .from("sms_otp_verifications")
      .update({
        verified_at: new Date().toISOString(),
        verification_token: verificationToken
      })
      .eq("id", record.id);

    if (updateError) throw updateError;

    return json({
      verified: true,
      verificationToken
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "OTP verification failed." }, 500);
  }
});
