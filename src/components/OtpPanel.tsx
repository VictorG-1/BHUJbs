type OtpPanelLabels = {
  sendOtp: string;
  resendOtp: string;
  sendingOtp: string;
  enterOtp: string;
  verifyOtp: string;
  verifyingOtp: string;
  verified: string;
};

type OtpPanelProps = {
  labels: OtpPanelLabels;
  otpCode: string;
  otpRequestId: string;
  verificationToken: string;
  otpSending: boolean;
  otpVerifying: boolean;
  otpStatus: string;
  loading?: boolean;
  onOtpCodeChange: (value: string) => void;
  onSendOtp: () => void;
  onVerifyOtp: () => void;
};

export function OtpPanel({
  labels,
  otpCode,
  otpRequestId,
  verificationToken,
  otpSending,
  otpVerifying,
  otpStatus,
  loading = false,
  onOtpCodeChange,
  onSendOtp,
  onVerifyOtp
}: OtpPanelProps) {
  return (
    <div className="otp-panel">
      <div className="otp-row">
        <button type="button" className="secondary" onClick={onSendOtp} disabled={otpSending || loading}>
          {otpSending ? labels.sendingOtp : otpRequestId ? labels.resendOtp : labels.sendOtp}
        </button>
        <input
          placeholder={labels.enterOtp}
          value={otpCode}
          onChange={(event) => onOtpCodeChange(event.target.value)}
          maxLength={6}
          inputMode="numeric"
          autoComplete="one-time-code"
        />
        <button
          type="button"
          className={verificationToken ? "active" : "secondary"}
          onClick={onVerifyOtp}
          disabled={otpVerifying || loading || !otpRequestId}
        >
          {otpVerifying ? labels.verifyingOtp : verificationToken ? labels.verified : labels.verifyOtp}
        </button>
      </div>
      {otpStatus ? <p className="inline-note otp-status">{otpStatus}</p> : null}
    </div>
  );
}
