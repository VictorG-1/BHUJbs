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

export async function sendSms({ mobile, message }: SmsPayload) {
  const user = Deno.env.get("SMSINDIAHUB_USER");
  const password = Deno.env.get("SMSINDIAHUB_PASSWORD");
  const senderId = Deno.env.get("SMSINDIAHUB_SENDER_ID");
  const channel = Deno.env.get("SMSINDIAHUB_CHANNEL") ?? "Promo";
  const dcs = Deno.env.get("SMSINDIAHUB_DCS") ?? "0";
  const flashSms = Deno.env.get("SMSINDIAHUB_FLASHSMS") ?? "0";
  const route = Deno.env.get("SMSINDIAHUB_ROUTE");
  const peId = Deno.env.get("SMSINDIAHUB_PE_ID");
  const dltTemplateId = Deno.env.get("SMSINDIAHUB_DLT_TEMPLATE_ID");

  if (!user || !password || !senderId || !route || !peId || !dltTemplateId) {
    throw new Error("Missing SMS India Hub credentials or template configuration.");
  }

  const url = new URL("http://cloud.smsindiahub.in/api/mt/SendSMS");
  url.searchParams.set("user", user);
  url.searchParams.set("password", password);
  url.searchParams.set("senderid", senderId);
  url.searchParams.set("channel", channel);
  url.searchParams.set("DCS", dcs);
  url.searchParams.set("flashsms", flashSms);
  url.searchParams.set("number", normalizeMobile(mobile));
  url.searchParams.set("text", message);
  url.searchParams.set("DLTTemplateId", dltTemplateId);
  url.searchParams.set("route", route);
  url.searchParams.set("PEId", peId);

  const response = await fetch(url.toString(), { method: "GET" });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(body || `SMS India Hub returned HTTP ${response.status}`);
  }

  return { provider: "smsindiahub", id: body };
}
