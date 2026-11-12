import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "../lib/supabase";

type MealType = "breakfast" | "lunch" | "dinner";

const MEAL_OPTIONS: { id: MealType; label: string }[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
];

export function ScannerPage() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const mealTypeRef = useRef<MealType>("breakfast");
  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [status, setStatus] = useState("Sign in with an event staff account to scan.");
  const [member, setMember] = useState<{
    name: string;
    room?: string;
    venue?: string;
    pothi?: string;
    category?: string;
    scanStatus?: string;
  } | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [checkingLogin, setCheckingLogin] = useState(false);
  const [manualPayload, setManualPayload] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    mealTypeRef.current = mealType;
  }, [mealType]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessionReady(Boolean(data.session));
      if (data.session) setStatus("Select a meal, then scan a card QR.");
    });
    return () => {
      void scannerRef.current?.stop().catch(() => undefined);
    };
  }, []);

  async function validate(decodedText: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setStatus("Please sign in first.");
      return;
    }
    setBusy(true);
    setStatus(`Validating ${mealTypeRef.current}...`);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-qr`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payload: decodedText,
          mealType: mealTypeRef.current,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMember(null);
        setStatus(body.error ?? "Invalid QR code.");
        return;
      }
      setMember(body.member);
      setStatus(
        body.alreadyScanned
          ? `Already validated for ${mealTypeRef.current} today.`
          : `${mealTypeRef.current} validated successfully.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function startScanner() {
    if (!sessionReady || busy) return;
    if (scannerRef.current) {
      await scannerRef.current.stop().catch(() => undefined);
      scannerRef.current = null;
    }
    const scanner = new Html5Qrcode("qr-reader");
    scannerRef.current = scanner;
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      async (text) => {
        await scanner.stop().catch(() => undefined);
        scannerRef.current = null;
        await validate(text);
      },
      () => undefined,
    );
    setStatus(`Camera ready for ${mealType}. Scan one card QR.`);
  }

  async function signOut() {
    await scannerRef.current?.stop().catch(() => undefined);
    scannerRef.current = null;
    await supabase.auth.signOut();
    setSessionReady(false);
    setMember(null);
    setStatus("Signed out. Sign in to open the scanner.");
  }

  async function validateManual(event: React.FormEvent) {
    event.preventDefault();
    if (!manualPayload.trim() || busy) return;
    await validate(manualPayload.trim());
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setCheckingLogin(true);
    setStatus("Signing in...");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      setStatus(error?.message ?? "Staff login failed.");
      setCheckingLogin(false);
      return;
    }
    const { data: profile } = await supabase
      .from("admin_profiles")
      .select("role")
      .eq("user_id", data.session.user.id)
      .maybeSingle();
    if (!profile || !["admin", "subadmin"].includes(profile.role)) {
      await supabase.auth.signOut();
      setStatus("This account is not enabled for QR validation.");
      setCheckingLogin(false);
      return;
    }
    setSessionReady(true);
    setStatus("Login successful. Select Breakfast, Lunch, or Dinner.");
    setCheckingLogin(false);
  }

  if (!sessionReady) {
    return (
      <section className="page-section compact scanner-page">
        <div className="dashboard-hero">
          <p className="eyebrow">Event staff</p>
          <h1>Meal QR login</h1>
          <p>Sign in to validate Breakfast, Lunch, or Dinner (one scan per meal per day).</p>
        </div>
        <form className="auth-card auth-form" onSubmit={signIn}>
          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <button className="primary" type="submit" disabled={checkingLogin}>
            {checkingLogin ? "Signing in..." : "Staff sign in"}
          </button>
          <p className="form-message">{status}</p>
        </form>
      </section>
    );
  }

  return (
    <section className="page-section scanner-page">
      <div className="dashboard-hero scanner-hero">
        <div>
          <p className="eyebrow">Event staff</p>
          <h1>Meal QR scanner</h1>
          <p>Only Breakfast, Lunch, and Dinner — each card can be validated once per meal per day.</p>
        </div>
        <button className="secondary scanner-signout" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>

      <div className="scanner-panel">
        <div className="meal-type-block">
          <p className="meal-type-label">Select meal to validate</p>
          <div className="meal-type-picker" role="group" aria-label="Meal type">
            {MEAL_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={mealType === option.id ? "meal-type-btn meal-type-btn--active" : "meal-type-btn"}
                onClick={() => {
                  setMealType(option.id);
                  setMember(null);
                  setStatus(`Selected ${option.label}. Scan a card QR.`);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div id="qr-reader" className="qr-reader" />
        <button className="primary" type="button" disabled={busy} onClick={() => void startScanner()}>
          Start camera ({MEAL_OPTIONS.find((m) => m.id === mealType)?.label})
        </button>

        <form className="manual-qr-form" onSubmit={validateManual}>
          <label>
            Manual QR payload
            <textarea
              value={manualPayload}
              onChange={(event) => setManualPayload(event.target.value)}
              placeholder="Paste the scanned QR text here"
              rows={4}
            />
          </label>
          <button className="secondary" type="submit" disabled={busy}>
            Validate for {MEAL_OPTIONS.find((m) => m.id === mealType)?.label}
          </button>
        </form>

        <p className={member ? "success-message" : "form-message"}>{status}</p>
        {member ? (
          <div className={`scan-result${status.toLowerCase().includes("already") ? " scan-result--repeat" : ""}`}>
            <strong>{member.name}</strong>
            <span>
              {[member.category, member.pothi ? `Pothi ${member.pothi}` : "", member.room ? `Room ${member.room}` : "", member.venue]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <small>{member.scanStatus}</small>
          </div>
        ) : null}
      </div>
    </section>
  );
}
