import { supabase } from "./supabase";
import type { AddFamilyMemberInput, RegisterFamilyInput, RegistrationResult, SendOtpResult, VerifyOtpResult } from "./types";
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
  if (input.registrationType !== "general_room" && sessionData.session?.access_token) {
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

export async function cancelRegistration(input: { familyId?: string; registrationCode?: string; headMobile?: string; memberId?: string; verificationToken?: string }) {
  const endpoint = import.meta.env.DEV
    ? "/dev-api/cancel-registration"
    : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cancel-registration`;
  const { data: sessionData } = await supabase.auth.getSession();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(import.meta.env.DEV
        ? {}
        : {
            ...getSupabasePublicHeaders(),
            ...(sessionData.session?.access_token
              ? { Authorization: `Bearer ${sessionData.session.access_token}` }
              : {})
          })
    },
    body: JSON.stringify(input)
  });
  const payload = (await response.json().catch(() => ({}))) as { success?: boolean; registrationCode?: string; error?: string; message?: string };
  if (!response.ok) throw new Error(payload.error ?? payload.message ?? `Cancellation failed. (HTTP ${response.status})`);
  return payload;
}

export async function getMyRegistration(input: { mobile: string; verificationToken: string; pothiId?: number }) {
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

export async function addFamilyMember(input: AddFamilyMemberInput) {
  const endpoint = import.meta.env.DEV
    ? "/dev-api/add-family-member"
    : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/add-family-member`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(import.meta.env.DEV
        ? {}
        : {
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ""}`
          })
    },
    body: JSON.stringify(input)
  });
  const payload = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string; message?: string };
  if (!response.ok) throw new Error(payload.error ?? payload.message ?? `Could not add member. (HTTP ${response.status})`);
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
  rooms: Array<Record<string, unknown>>;
  language?: "en" | "gu";
};

export async function downloadAdminWorkbook({ members, rooms, language = "en" }: WorkbookExportInput) {
  const workbook = XLSX.utils.book_new();
  const categorySheets = [
    { type: "pothi_room", name: "Pothi" },
    { type: "private_room", name: "Private" },
    { type: "general_room", name: "General" }
  ] as const;
  const headers = [
    "Member name", "Age", "Gender", "Member mobile", "Family / yajman", "Family mobile", "City",
    "Registration code", "Pothi number", "Arrival date", "Departure date", "Venue", "Room number", "Registration date"
  ];
  const distinct = (values: unknown[]) => new Set(values.filter((value) => value !== null && value !== undefined && value !== "")).size;

  for (const category of categorySheets) {
    const rows = members
      .filter((member) => member.registration_type === category.type)
      .sort((left, right) => {
        const pothiDelta = Number(left.pothi ?? 0) - Number(right.pothi ?? 0);
        if (pothiDelta) return pothiDelta;
        return String(left.name ?? "").localeCompare(String(right.name ?? ""), "en", { sensitivity: "base" });
      });
    const familyCount = distinct(rows.map((member) => member.family_id));
    const cityCount = distinct(rows.map((member) => member.city));
    const allocatedRooms = new Set(rows.map((member) => `${member.venue ?? ""}::${member.room ?? ""}`).filter((room) => !room.endsWith("::")));
    const roomCapacity = rooms
      .filter((room) => {
        const venue = String(room.venue_name ?? "").toUpperCase() === "HOTEL" && room.section_name
          ? room.section_name
          : room.venue_name ?? "";
        return allocatedRooms.has(`${venue}::${room.room_number ?? ""}`);
      })
      .reduce((total, room) => total + Number(room.total_capacity ?? 0), 0);
    const sheetRows = rows.map((member) => [
      member.name ?? "", member.age ?? "", member.gender ?? "", member.mobile ?? "", member.family_name ?? "",
      member.family_mobile ?? "", member.city ?? "", member.registration_code ?? "", member.pothi ?? "",
      member.arrival_date ?? "", member.departure_date ?? "", member.venue ?? "", member.room ?? "", member.created_at ?? ""
    ]);
    const sheet = XLSX.utils.aoa_to_sheet([
      [category.name + (language === "gu" ? " નોંધણી" : " registrations")],
      ["Total guests", rows.length],
      ["Total registrations", familyCount],
      ["Cities represented", cityCount],
      ["Rooms assigned", allocatedRooms.size],
      ["Assigned room capacity", roomCapacity],
      [],
      headers,
      ...sheetRows
    ]);
    sheet["!cols"] = [22, 8, 12, 17, 28, 17, 20, 18, 14, 16, 16, 28, 14, 22].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, sheet, category.name);
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

export type MealScanLogRow = {
  id: string;
  meal_type: "breakfast" | "lunch" | "dinner";
  scanned_at: string;
  scan_date: string;
  meal_qr_codes: {
    member_name: string | null;
    room: string | null;
    pothi: string | null;
    category: string | null;
    city: string | null;
    mobile: string | null;
    reg_code: string | null;
    arrival_date: string | null;
    departure_date: string | null;
  } | null;
};

export function todayIstDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function formatIstDisplayDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(year, month - 1, day).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatIstTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function normalizeMealQrCard(
  value: MealScanLogRow["meal_qr_codes"] | MealScanLogRow["meal_qr_codes"][] | null | undefined,
): MealScanLogRow["meal_qr_codes"] {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function fetchMealScanLogs(scanDate: string): Promise<MealScanLogRow[]> {
  const pageSize = 1000;
  let from = 0;
  const rows: MealScanLogRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("meal_scans")
      .select(
        "id, meal_type, scanned_at, scan_date, meal_qr_codes ( member_name, room, pothi, category, city, mobile, reg_code, arrival_date, departure_date )",
      )
      .eq("scan_date", scanDate)
      .order("scanned_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data?.length) break;

    for (const row of data as Array<Omit<MealScanLogRow, "meal_qr_codes"> & {
      meal_qr_codes: MealScanLogRow["meal_qr_codes"] | MealScanLogRow["meal_qr_codes"][];
    }>) {
      rows.push({
        id: row.id,
        meal_type: row.meal_type,
        scanned_at: row.scanned_at,
        scan_date: row.scan_date,
        meal_qr_codes: normalizeMealQrCard(row.meal_qr_codes),
      });
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

export async function downloadMealScanWorkbook(scanDate: string, logs?: MealScanLogRow[]) {
  const rows = logs ?? (await fetchMealScanLogs(scanDate));
  const workbook = XLSX.utils.book_new();
  const sheets = [
    { id: "breakfast" as const, name: "Breakfast" },
    { id: "lunch" as const, name: "Lunch" },
    { id: "dinner" as const, name: "Dinner" },
  ];
  const headers = [
    "Sr",
    "Scan time (IST)",
    "Name",
    "Room",
    "Pothi",
    "Category",
    "City",
    "Mobile",
    "Reg code",
    "Arrival",
    "Departure",
  ];

  for (const sheetDef of sheets) {
    const mealRows = rows
      .filter((row) => row.meal_type === sheetDef.id)
      .slice()
      .sort((a, b) => a.scanned_at.localeCompare(b.scanned_at));

    const body = mealRows.map((row, index) => {
      const card = row.meal_qr_codes;
      return [
        index + 1,
        formatIstTime(row.scanned_at),
        card?.member_name ?? "",
        card?.room ?? "",
        card?.pothi ?? "",
        card?.category ?? "",
        card?.city ?? "",
        card?.mobile ?? "",
        card?.reg_code ?? "",
        card?.arrival_date ?? "",
        card?.departure_date ?? "",
      ];
    });

    const sheet = XLSX.utils.aoa_to_sheet([
      [`${sheetDef.name} meal QR logs`],
      ["Date (IST)", scanDate, formatIstDisplayDate(scanDate)],
      ["Total scans", mealRows.length],
      [],
      headers,
      ...body,
    ]);
    sheet["!cols"] = [6, 16, 28, 12, 10, 14, 16, 14, 14, 12, 12].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, sheet, sheetDef.name);
  }

  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `meal-qr-logs-${scanDate}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
