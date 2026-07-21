import { supabase } from "./supabase";
import type { RegisterFamilyInput, RegistrationResult, SendOtpResult, VerifyOtpResult } from "./types";

export async function registerFamily(input: RegisterFamilyInput) {
  const { data, error } = await supabase.functions.invoke<RegistrationResult>("register-family", {
    body: input
  });
  if (error) throw error;
  return data;
}

export async function sendSmsOtp(input: { mobile: string; purpose?: "yajman" | "guest" }) {
  const { data, error } = await supabase.functions.invoke<SendOtpResult>("send-sms-otp", {
    body: input
  });
  if (error) throw error;
  return data;
}

export async function verifySmsOtp(input: { mobile: string; requestId: string; otp: string }) {
  const { data, error } = await supabase.functions.invoke<VerifyOtpResult>("verify-sms-otp", {
    body: input
  });
  if (error) throw error;
  return data;
}

export async function cancelRegistration(input: { familyId?: string; registrationCode?: string; headMobile?: string }) {
  const { data, error } = await supabase.functions.invoke<{ success: boolean; registrationCode: string }>(
    "cancel-registration",
    {
      body: input
    }
  );
  if (error) throw error;
  return data;
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
