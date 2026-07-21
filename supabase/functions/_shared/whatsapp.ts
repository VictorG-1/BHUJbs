type WhatsAppPayload = {
  mobile: string;
  message: string;
};

export async function sendWhatsApp({ mobile, message }: WhatsAppPayload) {
  const provider = Deno.env.get("WHATSAPP_PROVIDER") ?? "twilio";

  if (provider === "wati") {
    const baseUrl = Deno.env.get("WATI_BASE_URL");
    const token = Deno.env.get("WATI_API_TOKEN");
    if (!baseUrl || !token) throw new Error("Missing WATI credentials");

    const response = await fetch(`${baseUrl}/api/v1/sendSessionMessage/${encodeURIComponent(mobile)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ messageText: message })
    });

    const body = await response.text();
    if (!response.ok) throw new Error(body);
    return { provider: "wati", id: body };
  }

  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_WHATSAPP_FROM");
  if (!sid || !token || !from) throw new Error("Missing Twilio credentials");

  const form = new URLSearchParams();
  form.set("From", from);
  form.set("To", mobile.startsWith("whatsapp:") ? mobile : `whatsapp:${mobile}`);
  form.set("Body", message);

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
  });

  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return { provider: "twilio", id: body.sid as string };
}
