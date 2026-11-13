import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "../lib/supabase";

type MealType = "breakfast" | "lunch" | "dinner";
type ScanOutcome = "success" | "denied" | null;

const MEAL_OPTIONS: { id: MealType; label: string }[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
];

export function ScannerPage() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const mealTypeRef = useRef<MealType>("breakfast");
  const armScanRef = useRef(false);
  const validatingRef = useRef(false);

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
  const [outcome, setOutcome] = useState<ScanOutcome>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [checkingLogin, setCheckingLogin] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    mealTypeRef.current = mealType;
  }, [mealType]);

  useEffect(() => {
    armScanRef.current = armed;
  }, [armed]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessionReady(Boolean(data.session));
      if (data.session) setStatus("Select a meal, then start the camera.");
    });
    return () => {
      void scannerRef.current?.stop().catch(() => undefined);
    };
  }, []);

  async function validate(decodedText: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setStatus("Please sign in first.");
      setOutcome("denied");
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
        setOutcome("denied");
        setStatus(body.error ?? "Invalid QR code.");
        return;
      }
      setMember(body.member);
      if (body.alreadyScanned) {
        setOutcome("denied");
        setStatus(`Already validated for ${mealTypeRef.current} today.`);
      } else {
        setOutcome("success");
        setStatus(`${mealTypeRef.current} validated successfully.`);
      }
    } catch {
      setMember(null);
      setOutcome("denied");
      setStatus("Validation failed. Try again.");
    } finally {
      setBusy(false);
      setArmed(false);
      armScanRef.current = false;
      validatingRef.current = false;
    }
  }

  async function startCamera() {
    if (!sessionReady || busy) return;
    setOutcome(null);
    setMember(null);
    setArmed(false);
    armScanRef.current = false;

    if (scannerRef.current) {
      await scannerRef.current.stop().catch(() => undefined);
      scannerRef.current = null;
      setCameraOn(false);
    }

    const scanner = new Html5Qrcode("qr-reader");
    scannerRef.current = scanner;
    try {
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 30,
          qrbox: { width: 280, height: 280 },
          aspectRatio: 1,
          disableFlip: false,
        },
        (text) => {
          if (!armScanRef.current || validatingRef.current) return;
          validatingRef.current = true;
          armScanRef.current = false;
          setArmed(false);
          void validate(text);
        },
        () => undefined,
      );
      setCameraOn(true);
      setStatus(`Camera on for ${mealType}. Tap Scan QR when ready.`);
    } catch (error) {
      scannerRef.current = null;
      setCameraOn(false);
      setStatus(error instanceof Error ? error.message : "Could not start camera.");
      setOutcome("denied");
    }
  }

  function armScan() {
    if (!cameraOn || busy || !scannerRef.current) return;
    setOutcome(null);
    setMember(null);
    setArmed(true);
    armScanRef.current = true;
    validatingRef.current = false;
    setStatus("Point at the QR — scanning…");
  }

  async function stopCamera() {
    await scannerRef.current?.stop().catch(() => undefined);
    scannerRef.current = null;
    setCameraOn(false);
    setArmed(false);
    armScanRef.current = false;
    setStatus("Camera stopped. Start camera to scan again.");
  }

  async function signOut() {
    await stopCamera();
    await supabase.auth.signOut();
    setSessionReady(false);
    setMember(null);
    setOutcome(null);
    setStatus("Signed out. Sign in to open the scanner.");
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
                  setOutcome(null);
                  setArmed(false);
                  armScanRef.current = false;
                  setStatus(`Selected ${option.label}. Start camera, then tap Scan QR.`);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className={`qr-reader-wrap${armed ? " qr-reader-wrap--armed" : ""}`}>
          <div id="qr-reader" className="qr-reader" />
          {outcome === "success" ? (
            <div className="scan-mark scan-mark--ok" aria-hidden>
              <span>✓</span>
            </div>
          ) : null}
          {outcome === "denied" ? (
            <div className="scan-mark scan-mark--bad" aria-hidden>
              <span>×</span>
            </div>
          ) : null}
        </div>

        <div className="scanner-actions">
          {!cameraOn ? (
            <button className="primary" type="button" disabled={busy} onClick={() => void startCamera()}>
              Start camera
            </button>
          ) : (
            <>
              <button
                className="primary scan-qr-btn"
                type="button"
                disabled={busy || armed}
                onClick={armScan}
              >
                {armed ? "Scanning…" : busy ? "Validating…" : "Scan QR"}
              </button>
              <button className="secondary" type="button" disabled={busy} onClick={() => void stopCamera()}>
                Stop camera
              </button>
            </>
          )}
        </div>

        <p className={outcome === "success" ? "success-message" : "form-message"}>{status}</p>
        {member ? (
          <div
            className={`scan-result${
              outcome === "success" ? " scan-result--ok" : outcome === "denied" ? " scan-result--bad" : ""
            }`}
          >
            <div className="scan-result__mark" aria-hidden>
              {outcome === "success" ? "✓" : "×"}
            </div>
            <div className="scan-result__copy">
              <strong>{member.name}</strong>
              <span>
                {[
                  member.category,
                  member.pothi ? `Pothi ${member.pothi}` : "",
                  member.room ? `Room ${member.room}` : "",
                  member.venue,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <small>{member.scanStatus}</small>
            </div>
          </div>
        ) : outcome === "denied" ? (
          <div className="scan-result scan-result--bad">
            <div className="scan-result__mark" aria-hidden>
              ×
            </div>
            <div className="scan-result__copy">
              <strong>Not validated</strong>
              <small>{status}</small>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
