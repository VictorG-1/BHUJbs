import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import {
  downloadMealScanWorkbook,
  fetchMealScanLogs,
  formatIstDisplayDate,
  formatIstTime,
  todayIstDate,
  type MealScanLogRow,
} from "../lib/api";
import { supabase } from "../lib/supabase";

type MealType = "breakfast" | "lunch" | "dinner";
type ScanOutcome = "success" | "denied" | null;

const MEAL_OPTIONS: { id: MealType; label: string }[] = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
];

/** Pause between auto-scans so the same card is not validated repeatedly. */
const SCAN_COOLDOWN_MS = 1800;

export function ScannerPage() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const mealTypeRef = useRef<MealType>("breakfast");
  const validatingRef = useRef(false);
  const cooldownUntilRef = useRef(0);

  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [logDate, setLogDate] = useState(todayIstDate);
  const [logs, setLogs] = useState<MealScanLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
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
  const [busy, setBusy] = useState(false);

  const mealCounts = useMemo(() => {
    const counts = { breakfast: 0, lunch: 0, dinner: 0 };
    for (const row of logs) {
      if (row.meal_type in counts) counts[row.meal_type] += 1;
    }
    return counts;
  }, [logs]);

  const loadLogs = useCallback(async (date: string) => {
    setLogsLoading(true);
    try {
      const rows = await fetchMealScanLogs(date);
      setLogs(rows);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load meal logs.");
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    mealTypeRef.current = mealType;
  }, [mealType]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessionReady(Boolean(data.session));
      if (data.session) setStatus("Select a meal, then start the camera.");
    });
    return () => {
      void scannerRef.current?.stop().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    void loadLogs(logDate);
  }, [sessionReady, logDate, loadLogs]);

  async function validate(decodedText: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setStatus("Please sign in first.");
      setOutcome("denied");
      return;
    }
    setBusy(true);
    setOutcome(null);
    setMember(null);
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
        if (logDate === todayIstDate()) {
          void loadLogs(logDate);
        } else {
          setLogDate(todayIstDate());
        }
      }
    } catch {
      setMember(null);
      setOutcome("denied");
      setStatus("Validation failed. Try again.");
    } finally {
      setBusy(false);
      cooldownUntilRef.current = Date.now() + SCAN_COOLDOWN_MS;
      validatingRef.current = false;
    }
  }

  async function startCamera() {
    if (!sessionReady || busy) return;
    setOutcome(null);
    setMember(null);
    cooldownUntilRef.current = 0;
    validatingRef.current = false;

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
          if (validatingRef.current) return;
          if (Date.now() < cooldownUntilRef.current) return;
          validatingRef.current = true;
          void validate(text);
        },
        () => undefined,
      );
      setCameraOn(true);
      setStatus(`Camera on for ${mealType}. Point at a QR — scanning automatically.`);
    } catch (error) {
      scannerRef.current = null;
      setCameraOn(false);
      setStatus(error instanceof Error ? error.message : "Could not start camera.");
      setOutcome("denied");
    }
  }

  async function stopCamera() {
    await scannerRef.current?.stop().catch(() => undefined);
    scannerRef.current = null;
    setCameraOn(false);
    validatingRef.current = false;
    setStatus("Camera stopped. Start camera to scan again.");
  }

  async function signOut() {
    await stopCamera();
    await supabase.auth.signOut();
    setSessionReady(false);
    setMember(null);
    setOutcome(null);
    setLogs([]);
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
    setLogDate(todayIstDate());
    setStatus("Login successful. Select Breakfast, Lunch, or Dinner.");
    setCheckingLogin(false);
  }

  async function exportLogs() {
    setExporting(true);
    setStatus(`Preparing EOD export for ${formatIstDisplayDate(logDate)}...`);
    try {
      await downloadMealScanWorkbook(logDate, logs);
      setStatus(
        `Exported ${logs.length} scans · Breakfast ${mealCounts.breakfast}, Lunch ${mealCounts.lunch}, Dinner ${mealCounts.dinner}.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExporting(false);
    }
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
          <p className="scanner-date-line">
            Date (IST): <strong>{formatIstDisplayDate(logDate)}</strong>
          </p>
          <p>Only Breakfast, Lunch, and Dinner — each card can be validated once per meal per day.</p>
        </div>
        <button className="secondary scanner-signout" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>

      <div className="scanner-panel">
        <div className="meal-type-block">
          <div className="scanner-date-row">
            <label className="scanner-date-field">
              Log date
              <input
                type="date"
                value={logDate}
                max={todayIstDate()}
                onChange={(event) => setLogDate(event.target.value || todayIstDate())}
              />
            </label>
            <button
              className="secondary"
              type="button"
              disabled={logsLoading || logDate === todayIstDate()}
              onClick={() => setLogDate(todayIstDate())}
            >
              Today
            </button>
          </div>
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
                  setStatus(
                    cameraOn
                      ? `Selected ${option.label}. Point at a QR — scanning automatically.`
                      : `Selected ${option.label}. Start camera to auto-scan.`,
                  );
                }}
              >
                {option.label}
                <span className="meal-type-count">{mealCounts[option.id]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={`qr-reader-wrap${cameraOn ? " qr-reader-wrap--live" : ""}`}>
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
            <button className="secondary" type="button" disabled={busy} onClick={() => void stopCamera()}>
              {busy ? "Validating…" : "Stop camera"}
            </button>
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

        <div className="scan-logs-block">
          <div className="scan-logs-head">
            <div>
              <p className="meal-type-label">Meal logs · {formatIstDisplayDate(logDate)}</p>
              <p className="scan-logs-summary">
                Total {logs.length} · B {mealCounts.breakfast} · L {mealCounts.lunch} · D {mealCounts.dinner}
              </p>
            </div>
            <div className="scan-logs-actions">
              <button
                className="secondary"
                type="button"
                disabled={logsLoading}
                onClick={() => void loadLogs(logDate)}
              >
                {logsLoading ? "Refreshing…" : "Refresh"}
              </button>
              <button
                className="primary"
                type="button"
                disabled={exporting || logsLoading}
                onClick={() => void exportLogs()}
              >
                {exporting ? "Exporting…" : "Export EOD (3 sheets)"}
              </button>
            </div>
          </div>

          {logsLoading && !logs.length ? (
            <p className="form-message">Loading logs…</p>
          ) : logs.length === 0 ? (
            <p className="form-message">No scans for this date yet.</p>
          ) : (
            <ul className="scan-logs-list">
              {logs.map((row) => {
                const card = row.meal_qr_codes;
                const mealLabel = row.meal_type.charAt(0).toUpperCase() + row.meal_type.slice(1);
                return (
                  <li key={row.id} className={`scan-log-row scan-log-row--${row.meal_type}`}>
                    <span className="scan-log-meal">{mealLabel}</span>
                    <div className="scan-log-copy">
                      <strong>{card?.member_name || "Guest"}</strong>
                      <span>
                        {[
                          card?.category,
                          card?.pothi ? `Pothi ${card.pothi}` : "",
                          card?.room ? `Room ${card.room}` : "",
                          card?.city,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    </div>
                    <time className="scan-log-time" dateTime={row.scanned_at}>
                      {formatIstTime(row.scanned_at)}
                    </time>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
