import { Resend } from "resend";
import nodemailer from "nodemailer";

const html = (otp: string) => `
  <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
    <h2 style="margin:0 0 8px;color:#1e293b">Verify your ARF Map account</h2>
    <p style="margin:0 0 24px;color:#64748b">Enter this code to confirm your email address:</p>
    <div style="font-size:40px;font-weight:800;letter-spacing:10px;color:#2563eb;background:#eff6ff;padding:16px 24px;border-radius:8px;display:inline-block;margin-bottom:24px">
      ${otp}
    </div>
    <p style="color:#64748b;font-size:14px">This code expires in <strong>15 minutes</strong>. If you did not create an account, you can ignore this email.</p>
  </div>
`;

async function sendViaResendApi(to: string, otp: string): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.SMTP_FROM || "ARF Map <onboarding@resend.dev>",
    to,
    subject: "Your ARF Map verification code – " + otp,
    html: html(otp),
  });
  if (error) throw new Error(error.message);
}

async function sendViaSmtp(to: string, otp: string): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || "ARF Map <noreply@arf-map.app>",
    to,
    subject: "Your ARF Map verification code – " + otp,
    html: html(otp),
  });
}

const resetHtml = (otp: string) => `
  <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
    <h2 style="margin:0 0 8px;color:#1e293b">Reset your ARF Map password</h2>
    <p style="margin:0 0 24px;color:#64748b">Enter this code to set a new password:</p>
    <div style="font-size:40px;font-weight:800;letter-spacing:10px;color:#2563eb;background:#eff6ff;padding:16px 24px;border-radius:8px;display:inline-block;margin-bottom:24px">
      ${otp}
    </div>
    <p style="color:#64748b;font-size:14px">This code expires in <strong>15 minutes</strong>. If you did not request a password reset, you can safely ignore this email.</p>
  </div>
`;

function logOtp(to: string, otp: string) {
  console.log(`\n========================================`);
  console.log(`📧  Email verification OTP for ${to}`);
  console.log(`    Code: ${otp}`);
  console.log(`========================================\n`);
}

function logResetOtp(to: string, otp: string) {
  console.log(`\n========================================`);
  console.log(`🔑  Password reset OTP for ${to}`);
  console.log(`    Code: ${otp}`);
  console.log(`========================================\n`);
}

export async function sendVerificationEmail(to: string, otp: string): Promise<void> {
  // Try Resend if configured
  if (process.env.RESEND_API_KEY) {
    try {
      await sendViaResendApi(to, otp);
      return;
    } catch (err: any) {
      console.error(`[email] Resend API failed: ${err?.message ?? err} — trying SMTP fallback`);
    }
  }

  // Fallback: SMTP
  if (process.env.SMTP_HOST) {
    try {
      await sendViaSmtp(to, otp);
      return;
    } catch (err: any) {
      console.error(`[email] SMTP delivery failed: ${err?.message ?? err}`);
      if (process.env.NODE_ENV === "production") throw err;
    }
  }

  // Dev fallback: print to console
  logOtp(to, otp);
}

export async function sendPasswordResetEmail(to: string, otp: string): Promise<void> {
  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const { error } = await resend.emails.send({
        from: process.env.SMTP_FROM || "ARF Map <onboarding@resend.dev>",
        to,
        subject: "Reset your ARF Map password – " + otp,
        html: resetHtml(otp),
      });
      if (error) throw new Error(error.message);
      return;
    } catch (err: any) {
      console.error(`[email] Resend API failed for reset email: ${err?.message ?? err} — trying SMTP fallback`);
    }
  }

  if (process.env.SMTP_HOST) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || "587"),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM || "ARF Map <noreply@arf-map.app>",
        to,
        subject: "Reset your ARF Map password – " + otp,
        html: resetHtml(otp),
      });
      return;
    } catch (err: any) {
      console.error(`[email] SMTP delivery failed for reset email: ${err?.message ?? err}`);
      if (process.env.NODE_ENV === "production") throw err;
    }
  }

  logResetOtp(to, otp);
}
