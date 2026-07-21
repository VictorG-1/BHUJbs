import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl ?? "https://example.supabase.co",
  supabaseAnonKey ?? "missing-key"
);

export async function checkSupabaseConnection() {
  if (!isSupabaseConfigured) {
    return { ok: false as const, message: "Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env." };
  }

  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: supabaseAnonKey! },
      signal: controller.signal
    });
    window.clearTimeout(timeout);

    if (!response.ok) {
      return { ok: false as const, message: `Supabase returned HTTP ${response.status}. Check your project URL and API key.` };
    }

    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      message: `Cannot reach ${supabaseUrl}. The project may be paused, deleted, or the URL in .env is wrong.`
    };
  }
}
