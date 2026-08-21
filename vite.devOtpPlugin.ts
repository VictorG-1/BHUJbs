import type { IncomingMessage, ServerResponse } from "node:http";
import https from "node:https";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { URL } from "node:url";
import type { Plugin } from "vite";
import { createClient } from "@supabase/supabase-js";
import { buildOtpMessage } from "./src/lib/otpMessage";
import { registerFamilyDev, type RegisterInput } from "./devRegisterFamily";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function normalizeMobile(mobile: string) {
  return mobile.replace(/\D/g, "");
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function smsMobile(mobile: string) {
  const digits = normalizeMobile(mobile);
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

function postJson(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs = 60000
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: timeoutMs,
        family: 4
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Combirds SMS timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function sendCombirdsSms(
  env: Record<string, string>,
  mobile: string,
  message: string
) {
  const apiKey = env.COMBIRDS_API_KEY;
  const senderId = env.COMBIRDS_SENDER_ID;
  const templateId = env.COMBIRDS_TEMPLATE_ID;
  const baseUrl = env.COMBIRDS_SMS_BASE_URL ?? "https://smsapi.edumarcsms.com";

  if (!apiKey || !senderId || !templateId) {
    throw new Error("Missing Combirds SMS credentials. Set COMBIRDS_API_KEY, COMBIRDS_SENDER_ID, and COMBIRDS_TEMPLATE_ID in .env.local.");
  }

  if (!isValidCombirdsTemplateId(templateId)) {
    throw new Error("COMBIRDS_TEMPLATE_ID must be the DLT template ID from Combirds, not the SMS message text.");
  }

  const payload = JSON.stringify({
    number: [smsMobile(mobile)],
    message,
    senderId,
    templateId
  });

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await postJson(
        `${baseUrl}/api/v1/sendsms`,
        {
          "Content-Type": "application/json",
          apikey: apiKey
        },
        payload
      );

      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = response.text ? (JSON.parse(response.text) as Record<string, unknown>) : null;
      } catch {
        parsed = null;
      }

      const data = parsed?.data as Record<string, unknown> | undefined;
      const providerError =
        (parsed?.error as string | undefined) ??
        (parsed?.message as string | undefined) ??
        (typeof data?.msg === "string" && parsed?.success === false ? data.msg : undefined);

      if (response.status < 200 || response.status >= 300 || parsed?.success === false) {
        throw new Error(
          providerError ||
            response.text ||
            `Combirds SMS returned HTTP ${response.status}`
        );
      }

      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }

  throw lastError ?? new Error("Combirds SMS failed.");
}

export function devOtpPlugin(env: Record<string, string>): Plugin {
  const supabaseUrl = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  return {
    name: "dev-otp-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        if (
          path !== "/dev-api/send-sms-otp" &&
          path !== "/dev-api/verify-sms-otp" &&
          path !== "/dev-api/register-family" &&
          path !== "/dev-api/cancel-registration" &&
          path !== "/dev-api/get-registration"
        ) {
          return next();
        }

        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed." });
          return;
        }

        if (!supabaseUrl || !serviceKey) {
          sendJson(res, 500, {
            error:
              "Add SUPABASE_SERVICE_ROLE_KEY to .env.local (Supabase Dashboard → Settings → API → service_role key), then restart npm run dev."
          });
          return;
        }

        const supabase = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false }
        });

        try {
          const body = JSON.parse(await readBody(req)) as Record<string, string>;

          if (path === "/dev-api/send-sms-otp") {
            if (!body.mobile) {
              sendJson(res, 400, { error: "mobile is required." });
              return;
            }

            const mobile = normalizeMobile(body.mobile);
            if (mobile.length < 10) {
              sendJson(res, 400, { error: "Enter a valid mobile number." });
              return;
            }

            if (body.purpose === "yajman") {
              const { data: pothis, error: pothiError } = await supabase
                .from("pothis")
                .select("id, contact_mobile")
                .not("contact_mobile", "is", null);

              if (pothiError) throw pothiError;

              const pothi = pothis?.find((entry) => normalizeMobile(entry.contact_mobile ?? "") === mobile);
              if (!pothi) {
                sendJson(res, 404, { error: "This mobile number is not mapped to any Pothi Yajman contact." });
                return;
              }
            }

            const otp = String(randomInt(100000, 1000000));
            const otpHash = sha256(`${mobile}:${otp}`);
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
            const templateFirstVar = env.COMBIRDS_TEMPLATE_FIRST_VAR ?? "KMS";
            const message = buildOtpMessage(otp, templateFirstVar);

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

            if (!isValidCombirdsTemplateId(env.COMBIRDS_TEMPLATE_ID ?? "")) {
              throw new Error("SMS OTP is not configured. Set COMBIRDS_TEMPLATE_ID to the approved DLT template ID and restart the dev server.");
            }

            await sendCombirdsSms(env, mobile, message);

            sendJson(res, 200, {
              requestId: record.id,
              expiresAt,
              sent: true,
              smsSubmitted: true
            });
            return;
          }

          if (path === "/dev-api/register-family") {
            const result = await registerFamilyDev(body as unknown as RegisterInput, supabase);
            if (!result.ok) {
              sendJson(res, result.status, { error: result.error });
              return;
            }

            sendJson(res, 200, result.data);
            return;
          }

          if (path === "/dev-api/cancel-registration") {
            if (!body.familyId && !body.registrationCode) {
              sendJson(res, 400, { error: "Family id or registration code is required." });
              return;
            }
            let familyQuery = supabase.from("families").select("id, head_mobile, registration_code");
            familyQuery = body.familyId ? familyQuery.eq("id", body.familyId) : familyQuery.eq("registration_code", body.registrationCode);
            const { data: family, error: familyError } = await familyQuery.maybeSingle();
            if (familyError) throw familyError;
            if (!family) {
              sendJson(res, 404, { error: "Registration not found." });
              return;
            }
            if (body.headMobile && normalizeMobile(family.head_mobile) !== normalizeMobile(body.headMobile)) {
              sendJson(res, 403, { error: "Mobile number does not match this registration." });
              return;
            }
            const { data: linkedPothis, error: pothiError } = await supabase.from("pothis").select("id").eq("family_id", family.id);
            if (pothiError) throw pothiError;
            const { error: deleteError } = await supabase.from("families").delete().eq("id", family.id);
            if (deleteError) throw deleteError;
            const pothiIds = (linkedPothis ?? []).map((pothi) => pothi.id);
            if (pothiIds.length) {
              const { error: unlockError } = await supabase.from("pothis").update({ family_id: null, locked_at: null }).in("id", pothiIds);
              if (unlockError) throw unlockError;
            }
            sendJson(res, 200, { success: true, familyId: family.id, registrationCode: family.registration_code });
            return;
          }

          if (path === "/dev-api/get-registration") {
            if (!body.mobile || !body.verificationToken) {
              sendJson(res, 400, { error: "Verified mobile and OTP token are required." });
              return;
            }
            const mobile = normalizeMobile(body.mobile);
            const { data: verification, error: verificationError } = await supabase
              .from("sms_otp_verifications")
              .select("id, verified_at, verification_token")
              .eq("mobile", mobile)
              .eq("verification_token", body.verificationToken)
              .maybeSingle();
            if (verificationError) throw verificationError;
            if (!verification?.verified_at) {
              sendJson(res, 403, { error: "Please verify the mobile number with OTP first." });
              return;
            }
            const { data: families, error: familyError } = await supabase
              .from("families")
              .select("id, registration_code, registration_type, head_name, head_mobile, city, stay_from, stay_to, pothi_id, reference_pothi_id, private_room_number")
              .order("created_at", { ascending: false });
            if (familyError) throw familyError;
            let family = (families ?? []).find((entry) => normalizeMobile(entry.head_mobile ?? "") === mobile);
            if (!family) {
              const { data: memberMatch, error: memberError } = await supabase.from("members").select("family_id").eq("mobile", mobile).limit(1).maybeSingle();
              if (memberError) throw memberError;
              family = (families ?? []).find((entry) => entry.id === memberMatch?.family_id);
            }
            if (!family) {
              sendJson(res, 404, { found: false });
              return;
            }
            const { data: members, error: membersError } = await supabase.from("members").select("id, name").eq("family_id", family.id).order("created_at");
            if (membersError) throw membersError;
            const memberIds = (members ?? []).map((member) => member.id);
            const { data: allocations, error: allocationError } = await supabase
              .from("room_allocations")
              .select("member_id, rooms(room_number, venue_name, section_name, floor)")
              .in("member_id", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]);
            if (allocationError) throw allocationError;
            sendJson(res, 200, {
              found: true,
              family: { ...family, room_number: allocations?.[0]?.rooms?.room_number ?? null },
              members,
              allocations: (allocations ?? []).map((allocation) => ({
                member_id: allocation.member_id,
                member_name: members?.find((member) => member.id === allocation.member_id)?.name ?? "Guest",
                room_number: allocation.rooms?.room_number ?? "",
                venue_name: allocation.rooms?.venue_name ?? null,
                section_name: allocation.rooms?.section_name ?? null,
                floor: allocation.rooms?.floor ?? null
              }))
            });
            return;
          }

          if (!body.mobile || !body.requestId || !body.otp) {
            sendJson(res, 400, { error: "mobile, requestId and otp are required." });
            return;
          }

          const mobile = normalizeMobile(body.mobile);
          const { data: record, error: recordError } = await supabase
            .from("sms_otp_verifications")
            .select("id, mobile, otp_hash, expires_at, verified_at, consumed_at, attempts")
            .eq("id", body.requestId)
            .eq("mobile", mobile)
            .maybeSingle();

          if (recordError) throw recordError;
          if (!record) {
            sendJson(res, 404, { error: "OTP request not found." });
            return;
          }
          if (record.consumed_at) {
            sendJson(res, 400, { error: "This OTP request is no longer active." });
            return;
          }
          if (record.verified_at) {
            sendJson(res, 400, { error: "This OTP has already been verified." });
            return;
          }
          if (new Date(record.expires_at).getTime() < Date.now()) {
            sendJson(res, 400, { error: "OTP has expired. Please request a new one." });
            return;
          }
          if ((record.attempts ?? 0) >= 5) {
            sendJson(res, 429, { error: "Too many incorrect attempts. Please request a new OTP." });
            return;
          }

          const otpHash = sha256(`${mobile}:${body.otp}`);
          if (otpHash !== record.otp_hash) {
            await supabase
              .from("sms_otp_verifications")
              .update({ attempts: (record.attempts ?? 0) + 1 })
              .eq("id", record.id);

            sendJson(res, 400, { error: "Incorrect OTP." });
            return;
          }

          const verificationToken = randomUUID();
          const { error: updateError } = await supabase
            .from("sms_otp_verifications")
            .update({
              verified_at: new Date().toISOString(),
              verification_token: verificationToken
            })
            .eq("id", record.id);

          if (updateError) throw updateError;

          sendJson(res, 200, {
            verified: true,
            verificationToken
          });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "OTP request failed."
          });
        }
      });
    }
  };
}
