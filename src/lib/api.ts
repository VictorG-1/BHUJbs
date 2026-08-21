import { supabase } from "./supabase";
import type { RegisterFamilyInput, RegistrationResult, SendOtpResult, VerifyOtpResult } from "./types";
import * as XLSX from "xlsx";

function getSupabasePublicHeaders() {
  // OTP, registration, cancellation and lookup functions are deployed with
  // verify_jwt=false. Omitting the optional API key prevents stale Vercel
  // keys from being rejected by the Supabase gateway before CORS/function code.
  return {};
}

async function extractFunctionError(error: unknown, fallbackMessage: string) {
  if (!error) return fallbackMessage;

  if (typeof error === "object" && error && "context" in error) {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const body = (await context.clone().json()) as { error?: string; message?: string; code?: string };
        if (body.error) return body.error;
        if (body.message) {
          if (body.code === "NOT_FOUND") {
            return "OTP service is not deployed. Run: npx supabase functions deploy send-sms-otp verify-sms-otp";
          }
          return body.message;
        }
      } catch {
        // Fall through to generic parsing below.
      }
    }
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (message && message !== "Failed to send a request to the Edge Function") {
      return message;
    }
  }

  if (typeof error === "object" && error && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (message && message !== "Failed to send a request to the Edge Function") {
      return message;
    }
  }

  return fallbackMessage;
}

async function invokeOtp<T>(
  functionName: "send-sms-otp" | "verify-sms-otp",
  body: Record<string, unknown>,
  fallbackMessage: string
) {
  const endpoint = import.meta.env.DEV
    ? `/dev-api/${functionName}`
    : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(import.meta.env.DEV
          ? {}
          : getSupabasePublicHeaders())
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    if (error instanceof TypeError && /fetch/i.test(error.message)) {
      throw new Error(
        `Cannot reach ${functionName}. Deploy the Supabase Edge Function and check its production URL and CORS settings.`
      );
    }
    throw error;
  }

  const payload = (await response.json().catch(() => ({}))) as (T & { error?: string; message?: string }) | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? payload?.message ?? `${fallbackMessage} (HTTP ${response.status})`);
  }

  if (payload && typeof payload === "object" && "error" in payload && payload.error) {
    throw new Error(payload.error);
  }

  return payload;
}

export async function registerFamily(input: RegisterFamilyInput) {
  if (import.meta.env.DEV) {
    const response = await fetch("/dev-api/register-family", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });

    const payload = (await response.json().catch(() => ({}))) as RegistrationResult & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "Registration failed.");
    }
    return payload;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getSupabasePublicHeaders()
  };
  if (sessionData.session?.access_token) {
    headers.Authorization = `Bearer ${sessionData.session.access_token}`;
  }

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-family`, {
    method: "POST",
    headers,
    body: JSON.stringify(input)
  });
  const payload = (await response.json().catch(() => ({}))) as RegistrationResult & { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? payload.message ?? `Registration failed. (HTTP ${response.status})`);
  }
  return payload;
}

export async function sendSmsOtp(input: { mobile: string; purpose?: "yajman" | "guest" }) {
  const data = await invokeOtp<SendOtpResult>("send-sms-otp", input, "OTP send failed.");
  if (!data?.requestId) throw new Error("OTP provider returned an empty response.");
  return data;
}

export async function verifySmsOtp(input: { mobile: string; requestId: string; otp: string }) {
  const data = await invokeOtp<VerifyOtpResult>("verify-sms-otp", input, "OTP verification failed.");
  if (!data?.verificationToken) throw new Error("OTP verification returned an empty response.");
  return data;
}

export async function cancelRegistration(input: { familyId?: string; registrationCode?: string; headMobile?: string }) {
  const endpoint = import.meta.env.DEV
    ? "/dev-api/cancel-registration"
    : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cancel-registration`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(import.meta.env.DEV
        ? {}
        : getSupabasePublicHeaders())
    },
    body: JSON.stringify(input)
  });
  const payload = (await response.json().catch(() => ({}))) as { success?: boolean; registrationCode?: string; error?: string; message?: string };
  if (!response.ok) throw new Error(payload.error ?? payload.message ?? `Cancellation failed. (HTTP ${response.status})`);
  return payload;
}

export async function getMyRegistration(input: { mobile: string; verificationToken: string }) {
  const endpoint = import.meta.env.DEV
    ? "/dev-api/get-registration"
    : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-registration`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(import.meta.env.DEV
        ? {}
        : getSupabasePublicHeaders())
    },
    body: JSON.stringify(input)
  });
  const payload = (await response.json().catch(() => ({}))) as RegistrationResult & { found?: boolean; error?: string; message?: string };
  if (response.status === 404 && payload.found === false) return null;
  if (!response.ok) throw new Error(payload.error ?? payload.message ?? `Could not load registration. (HTTP ${response.status})`);
  return payload;
}

export async function downloadExportData() {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Admin login required.");

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-data`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Export failed." }));
    throw new Error(error.error ?? "Export failed.");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "bhagwat-saptah-guests.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

type WorkbookExportInput = {
  members: Array<Record<string, unknown>>;
  pothis: Array<Record<string, unknown>>;
  rooms: Array<Record<string, unknown>>;
  language?: "en" | "gu";
};

function sanitizeSheetName(name: string) {
  const cleaned = name.replace(/[\[\]\*\/\\\?\:]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "Sheet").slice(0, 31);
}

function uniqueSheetName(baseName: string, used: Set<string>) {
  let candidate = sanitizeSheetName(baseName);
  let suffix = 2;
  while (used.has(candidate)) {
    const root = sanitizeSheetName(baseName).slice(0, Math.max(1, 31 - String(suffix).length - 1));
    candidate = `${root}-${suffix}`.slice(0, 31);
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

export async function downloadAdminWorkbook({ members, pothis, rooms, language = "en" }: WorkbookExportInput) {
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  const summarySheet = XLSX.utils.json_to_sheet([
    {
      metric: language === "gu" ? "કુલ સભ્યો" : "Total members",
      value: members.length
    },
    {
      metric: language === "gu" ? "કુલ પરિવારો" : "Total families",
      value: new Set(members.map((member) => member.family_id).filter(Boolean)).size
    },
    {
      metric: language === "gu" ? "કુલ પોથી" : "Total pothis",
      value: pothis.length
    },
    {
      metric: language === "gu" ? "ભરાયેલ પોથી" : "Occupied pothis",
      value: pothis.filter((pothi) => pothi.family_id).length
    },
    {
      metric: language === "gu" ? "કુલ રૂમ" : "Total rooms",
      value: rooms.length
    }
  ]);
  XLSX.utils.book_append_sheet(workbook, summarySheet, uniqueSheetName(language === "gu" ? "સારાંશ" : "Summary", usedNames));

  const memberSheet = XLSX.utils.json_to_sheet(
    members.map((member) => ({
      member_name: member.name,
      age: member.age,
      gender: member.gender,
      mobile: member.mobile ?? "",
      family_id: member.family_id ?? "",
      family_name: member.family_name ?? "",
      family_mobile: member.family_mobile ?? "",
      registration_type: member.registration_type ?? "",
      pothi: member.pothi ?? "",
      venue: member.venue ?? "",
      room: member.room ?? ""
    }))
  );
  XLSX.utils.book_append_sheet(workbook, memberSheet, uniqueSheetName(language === "gu" ? "સભ્યો" : "Members", usedNames));

  const guestListSheet = XLSX.utils.json_to_sheet(
    members.map((member) => ({
      name: member.name,
      family: member.family_name ?? "",
      mobile: member.mobile ?? "",
      pothi: member.pothi ?? "",
      venue: member.venue ?? "",
      room: member.room ?? "",
      registration_type: member.registration_type ?? ""
    }))
  );
  XLSX.utils.book_append_sheet(
    workbook,
    guestListSheet,
    uniqueSheetName(language === "gu" ? "મહેમાન યાદી" : "Guest List", usedNames)
  );

  const pothiSheet = XLSX.utils.json_to_sheet(
    pothis.map((pothi) => ({
      pothi_number: pothi.id,
      primary_holder_name: pothi.primary_holder_name ?? "",
      city: pothi.city ?? "",
      contact_name: pothi.contact_name ?? "",
      contact_mobile: pothi.contact_mobile ?? "",
      status: pothi.family_id ? (language === "gu" ? "ભરાયેલ" : "Occupied") : language === "gu" ? "ખાલી" : "Open"
    }))
  );
  XLSX.utils.book_append_sheet(workbook, pothiSheet, uniqueSheetName(language === "gu" ? "પોથી" : "Pothis", usedNames));

  const venueGroups = new Map<string, Array<Record<string, unknown>>>();
  for (const room of rooms) {
    const venue = String(room.venue_name || (language === "gu" ? "અન્ય વેન્યુ" : "Other venue"));
    const list = venueGroups.get(venue) ?? [];
    list.push({
      room_number: room.room_number,
      section_name: room.section_name ?? "",
      floor: room.floor ?? "",
      room_type: room.room_type ?? "",
      total_capacity: room.total_capacity ?? "",
      owner_type: room.owner_type ?? "",
      linked_pothi_id: room.linked_pothi_id ?? "",
      allotment_note: room.allotment_note ?? ""
    });
    venueGroups.set(venue, list);
  }

  for (const [venue, rows] of venueGroups.entries()) {
    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, uniqueSheetName(venue, usedNames));
  }

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "bhagwat-saptah-admin-workbook.xlsx";
  anchor.click();
  URL.revokeObjectURL(url);
}
