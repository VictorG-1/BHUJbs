import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "../lib/supabase";

export function ScannerPage() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [status, setStatus] = useState("Sign in with an event staff account to scan.");
  const [member, setMember] = useState<{ name: string; room?: string; venue?: string; scanStatus?: string } | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [checkingLogin, setCheckingLogin] = useState(false);
  const [manualPayload, setManualPayload] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessionReady(Boolean(data.session));
      if (data.session) setStatus("Camera ready. Scan a member QR code.");
    });
    return () => { void scannerRef.current?.stop().catch(() => undefined); };
  }, []);

  async function validate(decodedText: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setStatus("Please sign in first."); return; }
    setStatus("Validating QR...");
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-qr`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ payload: decodedText, scanType: "entry" })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setMember(null); setStatus(body.error ?? "Invalid QR code."); return; }
    setMember(body.member);
    setStatus(body.alreadyScanned ? "Valid QR. This entry was already scanned." : "Valid QR. Entry recorded.");
  }

  async function startScanner() {
    if (!sessionReady) return;
    const scanner = new Html5Qrcode("qr-reader");
    scannerRef.current = scanner;
    await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, async (text) => {
      await scanner.stop().catch(() => undefined);
      scannerRef.current = null;
      await validate(text);
    }, () => undefined);
    setStatus("Camera ready. Scan a member QR code.");
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
    if (!manualPayload.trim()) return;
    await validate(manualPayload.trim());
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setCheckingLogin(true);
    setStatus("Signing in...");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) { setStatus(error?.message ?? "Staff login failed."); setCheckingLogin(false); return; }
    const { data: profile } = await supabase.from("admin_profiles").select("role").eq("user_id", data.session.user.id).maybeSingle();
    if (!profile || !["admin", "subadmin"].includes(profile.role)) {
      await supabase.auth.signOut();
      setStatus("This account is not enabled for QR validation.");
      setCheckingLogin(false);
      return;
    }
    setSessionReady(true);
    setStatus("Login successful. Camera ready.");
    setCheckingLogin(false);
  }

  if (!sessionReady) {
    return <section className="page-section compact scanner-page">
      <div className="dashboard-hero"><p className="eyebrow">Event staff</p><h1>QR validation login</h1><p>Sign in to open the event QR scanner.</p></div>
      <form className="auth-card auth-form" onSubmit={signIn}>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <button className="primary" type="submit" disabled={checkingLogin}>{checkingLogin ? "Signing in..." : "Staff sign in"}</button>
        <p className="form-message">{status}</p>
      </form>
    </section>;
  }

  return <section className="page-section scanner-page">
    <div className="dashboard-hero scanner-hero"><div><p className="eyebrow">Event staff</p><h1>QR validation scanner</h1><p>Scan a registered member QR code to validate entry and see the assigned room.</p></div><button className="secondary scanner-signout" type="button" onClick={() => void signOut()}>Sign out</button></div>
    <div className="scanner-panel">
      <div id="qr-reader" className="qr-reader" />
      <button className="primary" type="button" onClick={() => void startScanner()}>Start camera</button>
      <form className="manual-qr-form" onSubmit={validateManual}>
        <label>Manual QR payload<textarea value={manualPayload} onChange={(event) => setManualPayload(event.target.value)} placeholder="Paste the scanned QR text here" rows={3} /></label>
        <button className="secondary" type="submit">Validate manually</button>
      </form>
      <p className={member ? "success-message" : "form-message"}>{status}</p>
      {member ? <div className="scan-result"><strong>{member.name}</strong><span>{member.venue || "Venue pending"} {member.room ? `| Room ${member.room}` : ""}</span><small>{member.scanStatus || "Entry validated"}</small></div> : null}
    </div>
  </section>;
}
