export function buildOtpMessage(otp: string, firstVariable = "KMS") {
  const label = firstVariable.trim() || "user";
  const prefix = firstVariable.trim() ? `Dear ${label} user` : "Dear user";
  return `${prefix}, your OTP for login to https://www.teamfullstack.in/ is: ${otp}. Do not share this code with anyone. - Team Full Stack`;
}
