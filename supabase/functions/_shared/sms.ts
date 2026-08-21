type SmsPayload = {
  mobile: string;
  message: string;
};

function normalizeMobile(mobile: string) {
  const digits = mobile.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

function isValidCombirdsTemplateId(templateId: string) {
  const value = templateId.trim();
  if (!value) return false;
  if (value.length > 64) return false;
  if (value.includes("{#var#}") || value.includes("Dear ")) return false;
  return true;
}

export async function sendSms({ mobile, message }: SmsPayload) {
  const apiKey = Deno.env.get("COMBIRDS_API_KEY");
  const senderId = Deno.env.get("COMBIRDS_SENDER_ID");
  const templateId = Deno.env.get("COMBIRDS_TEMPLATE_ID");
  const baseUrl = Deno.env.get("COMBIRDS_SMS_BASE_URL") ?? "https://smsapi.edumarcsms.com";

  if (!apiKey || !senderId || !templateId) {
    throw new Error("Missing Combirds SMS credentials or template configuration.");
  }

  if (!isValidCombirdsTemplateId(templateId)) {
    throw new Error("COMBIRDS_TEMPLATE_ID must be the DLT template ID from Combirds, not the SMS message text.");
  }

  const normalizedMobile = normalizeMobile(mobile);

  const response = await fetch(`${baseUrl}/api/v1/sendsms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey
    },
    body: JSON.stringify({
      number: [normalizedMobile],
      message,
      senderId,
      templateId
    })
  });

  const rawBody = await response.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
  } catch {
    parsed = null;
  }

  const data = parsed?.data as Record<string, unknown> | undefined;
  const providerError =
    (parsed?.error as string | undefined) ??
    (parsed?.message as string | undefined) ??
    (typeof data?.msg === "string" && parsed?.success === false ? data.msg : undefined);

  if (!response.ok || parsed?.success === false) {
    throw new Error(
      providerError ||
        rawBody ||
        `Combirds SMS returned HTTP ${response.status}`
    );
  }

  const transactionId =
    (data?.transactionId as string | undefined) ??
    (parsed?.transaction_id as string | undefined) ??
    (parsed?.transactionId as string | undefined) ??
    rawBody;

  return { provider: "combirds", id: transactionId };
}
