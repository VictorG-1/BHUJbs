import { useEffect, useState } from "react";
import QRCode from "qrcode";

export const QR_EVENT_CODE = "KMS-BHAGWAT-2026";

export function qrPayload(member: { id: string; qr_token?: string; name?: string; age?: number; gender?: string; mobile?: string | null; family_code?: string; venue?: string; room?: string }) {
  return JSON.stringify({ event: QR_EVENT_CODE, member_id: member.id, token: member.qr_token, guest: { name: member.name, age: member.age, gender: member.gender, mobile: member.mobile, family_code: member.family_code, venue: member.venue, room: member.room } });
}

export function useQrDataUrl(member: { id: string; qr_token?: string; name?: string; age?: number; gender?: string; mobile?: string | null; family_code?: string; venue?: string; room?: string }) {
  const [dataUrl, setDataUrl] = useState("");
  useEffect(() => {
    if (!member.qr_token) return;
    QRCode.toDataURL(qrPayload(member), { width: 280, margin: 2, errorCorrectionLevel: "M" })
      .then(setDataUrl)
      .catch(() => setDataUrl(""));
  }, [member.id, member.qr_token]);
  return dataUrl;
}

export function downloadQr(dataUrl: string, name: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `${name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "member"}-qr.png`;
  link.click();
}

export function MemberQrCode({ member, details }: { member: { id: string; name: string; age?: number; gender?: string; mobile?: string | null; qr_token?: string }; details?: { family_code?: string; venue?: string; room?: string } }) {
  const dataUrl = useQrDataUrl({ ...member, ...details });
  if (!member.qr_token) return <p className="inline-note">QR code will be available after the database migration is deployed.</p>;
  return (
    <article className="member-qr-card">
      {dataUrl ? <img src={dataUrl} alt={`QR code for ${member.name}`} /> : <span className="qr-loading">Creating QR...</span>}
      <div>
        <strong>{member.name}</strong>
        <small>Entry and event validation</small>
        <button type="button" className="secondary" disabled={!dataUrl} onClick={() => downloadQr(dataUrl, member.name)}>
          Download QR
        </button>
      </div>
    </article>
  );
}
