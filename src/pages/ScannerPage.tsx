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

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
}

function cameraErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const lower = raw.toLowerCase();
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Camera needs HTTPS (or localhost). Open the live site, not a plain http link.";
  }
  if (lower.includes("notallowed") || lower.includes("permission") || lower.includes("denied")) {
    return "Camera permission blocked. Allow Camera in browser settings, then tap Start camera again.";
  }
  if (lower.includes("notfound") || lower.includes("requested device not found") || lower.includes("no cameras")) {
    return "No camera found. Use a phone with a rear camera, or tap Switch camera.";
  }
  if (lower.includes("notreadable") || lower.includes("trackstart") || lower.includes("in use")) {
    return "Camera is busy in another app. Close other camera apps and try again.";
  }
  if (lower.includes("overconstrained")) {
    return "This phone rejected the camera mode. Tap Switch camera or Start camera again.";
  }
  return raw || "Could not start camera.";
}

function pickBackCameraId(cameras: { id: string; label: string }[]) {
  if (!cameras.length) return null;
  const ranked = cameras
    .map((camera, index) => {
      const label = camera.label.toLowerCase();
      let score = 0;
      if (/back|rear|environment|world|posterior|facing back/.test(label)) score += 40;
      if (/ultra|wide|tele/.test(label)) score += 5;
      if (/front|user|face|selfie/.test(label)) score -= 40;
      if (!label) score += index === cameras.length - 1 ? 10 : 0;
      return { id: camera.id, score };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.id ?? cameras[0].id;
}

function scanBoxSize() {
  const el = document.getElementById("qr-reader");
  const width = el?.clientWidth || Math.min(window.innerWidth - 32, 420);
  const side = Math.max(160, Math.min(Math.floor(width * 0.72), isMobileDevice() ? 240 : 280));
  return { width: side, height: side };
}

function tuneVideoElement() {
  const video = document.querySelector("#qr-reader video") as HTMLVideoElement | null;
  if (!video) return;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.muted = true;
  void video.play().catch(() => undefined);
}

export function ScannerPage() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const mealTypeRef = useRef<MealType>("breakfast");
  const validatingRef = useRef(false);
  const cooldownUntilRef = useRef(0);
  const cameraIdsRef = useRef<string[]>([]);
  const cameraIndexRef = useRef(0);

  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [logDate, setLogDate] = useState(todayIstDate);
  const [logs, setLogs] = useState<MealScanLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);
  const [logMealFilter, setLogMealFilter] = useState<"all" | MealType>("all");
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
  const [startingCamera, setStartingCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cameraCount, setCameraCount] = useState(0);

  const mealCounts = useMemo(() => {
    const counts = { breakfast: 0, lunch: 0, dinner: 0 };
    for (const row of logs) {
      if (row.meal_type in counts) counts[row.meal_type] += 1;
    }
    return counts;
  }, [logs]);

  const visibleLogs = useMemo(() => {
    if (logMealFilter === "all") return logs;
    return logs.filter((row) => row.meal_type === logMealFilter);
  }, [logs, logMealFilter]);

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
    const {
      data: { session },
    } = await supabase.auth.getSession();
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

  async function stopScannerInstance() {
    if (!scannerRef.current) return;
    await scannerRef.current.stop().catch(() => undefined);
    try {
      scannerRef.current.clear();
    } catch {
      /* ignore */
    }
    scannerRef.current = null;
  }

  async function startWithConfig(scanner: Html5Qrcode, cameraConfig: string | MediaTrackConstraints) {
    const mobile = isMobileDevice();
    const config = {
      fps: mobile ? 12 : 20,
      qrbox: scanBoxSize,
      disableFlip: false,
      ...(mobile ? {} : { aspectRatio: 1.333 }),
    };
    await scanner.start(
      cameraConfig,
      config,
      (text) => {
        if (validatingRef.current) return;
        if (Date.now() < cooldownUntilRef.current) return;
        validatingRef.current = true;
        void validate(text);
      },
      () => undefined,
    );
    tuneVideoElement();
  }

  async function startCamera(preferredIndex?: number) {
    if (!sessionReady || busy || startingCamera) return;
    setStartingCamera(true);
    setOutcome(null);
    setMember(null);
    cooldownUntilRef.current = 0;
    validatingRef.current = false;
    setStatus("Opening camera… Allow permission if asked.");

    await stopScannerInstance();
    setCameraOn(false);

    const reader = document.getElementById("qr-reader");
    if (reader) reader.innerHTML = "";

    const scanner = new Html5Qrcode("qr-reader", {
      verbose: false,
      useBarCodeDetectorIfSupported: true,
    });
    scannerRef.current = scanner;

    try {
      let cameras: { id: string; label: string }[] = [];
      try {
        cameras = await Html5Qrcode.getCameras();
      } catch {
        cameras = [];
      }

      cameraIdsRef.current = cameras.map((camera) => camera.id);
      setCameraCount(cameras.length);

      if (cameras.length) {
        const backId = pickBackCameraId(cameras);
        const backIndex = Math.max(
          0,
          cameras.findIndex((camera) => camera.id === backId),
        );
        const index =
          typeof preferredIndex === "number"
            ? ((preferredIndex % cameras.length) + cameras.length) % cameras.length
            : backIndex;
        cameraIndexRef.current = index;

        const order = [cameras[index].id, ...cameras.map((camera) => camera.id).filter((_, i) => i !== index)];
        let started = false;
        let lastError: unknown;
        for (const cameraId of order) {
          try {
            await startWithConfig(scanner, cameraId);
            cameraIndexRef.current = cameras.findIndex((camera) => camera.id === cameraId);
            started = true;
            break;
          } catch (error) {
            lastError = error;
            await scanner.stop().catch(() => undefined);
            try {
              scanner.clear();
            } catch {
              /* ignore */
            }
          }
        }
        if (!started) throw lastError ?? new Error("Could not start camera.");
      } else {
        try {
          await startWithConfig(scanner, { facingMode: "environment" });
        } catch {
          await startWithConfig(scanner, { facingMode: "user" });
        }
      }

      setCameraOn(true);
      setStatus(`Camera on for ${mealType}. Hold phone steady — scanning automatically.`);
    } catch (error) {
      await stopScannerInstance();
      setCameraOn(false);
      setStatus(cameraErrorMessage(error));
      setOutcome("denied");
    } finally {
      setStartingCamera(false);
    }
  }

  async function switchCamera() {
    if (!cameraIdsRef.current.length) {
      await startCamera();
      return;
    }
    const next = (cameraIndexRef.current + 1) % cameraIdsRef.current.length;
    await startCamera(next);
  }

  async function stopCamera() {
    await stopScannerInstance();
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
            <input
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
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
          <p>Use rear camera · hold QR inside the box · keep phone steady.</p>
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

        <div className={`scanner-actions${cameraOn && cameraCount > 1 ? " scanner-actions--split" : ""}`}>
          {!cameraOn ? (
            <button
              className="primary"
              type="button"
              disabled={busy || startingCamera}
              onClick={() => void startCamera()}
            >
              {startingCamera ? "Opening camera…" : "Start camera"}
            </button>
          ) : (
            <>
              {cameraCount > 1 ? (
                <button
                  className="secondary"
                  type="button"
                  disabled={busy || startingCamera}
                  onClick={() => void switchCamera()}
                >
                  Switch camera
                </button>
              ) : null}
              <button className="secondary" type="button" disabled={busy || startingCamera} onClick={() => void stopCamera()}>
                {busy ? "Validating…" : "Stop camera"}
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

        <div className="scan-logs-block">
          <div className="scan-logs-head">
            <div>
              <p className="meal-type-label">All scanned QRs · {formatIstDisplayDate(logDate)}</p>
              <p className="scan-logs-summary">
                Total {logs.length} · B {mealCounts.breakfast} · L {mealCounts.lunch} · D {mealCounts.dinner}
                {logMealFilter !== "all" ? ` · showing ${visibleLogs.length}` : ""}
              </p>
            </div>
            <div className="scan-logs-actions">
              <button className="secondary" type="button" onClick={() => setLogsOpen((open) => !open)}>
                {logsOpen ? "Hide list" : "Show list"}
              </button>
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

          {logsOpen ? (
            <>
              <div className="scan-log-filters" role="group" aria-label="Filter scanned QRs by meal">
                {(
                  [
                    { id: "all" as const, label: "All", count: logs.length },
                    { id: "breakfast" as const, label: "Breakfast", count: mealCounts.breakfast },
                    { id: "lunch" as const, label: "Lunch", count: mealCounts.lunch },
                    { id: "dinner" as const, label: "Dinner", count: mealCounts.dinner },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={
                      logMealFilter === option.id ? "scan-log-filter scan-log-filter--active" : "scan-log-filter"
                    }
                    onClick={() => setLogMealFilter(option.id)}
                  >
                    {option.label}
                    <span>{option.count}</span>
                  </button>
                ))}
              </div>
              {logsLoading && !logs.length ? (
                <p className="form-message">Loading scanned QRs…</p>
              ) : logs.length === 0 ? (
                <p className="form-message">No scans for this date yet.</p>
              ) : visibleLogs.length === 0 ? (
                <p className="form-message">No {logMealFilter} scans for this date.</p>
              ) : (
                <ul className="scan-logs-list">
                  {visibleLogs.map((row) => {
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
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
