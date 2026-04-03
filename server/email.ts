import nodemailer from "nodemailer";

function createTransporter() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendVerificationEmail(to: string, otp: string): Promise<void> {
  const transporter = createTransporter();

  const html = `
    <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
      <h2 style="margin:0 0 8px;color:#1e293b">Verify your ARF Map account</h2>
      <p style="margin:0 0 24px;color:#64748b">Enter this code to confirm your email address:</p>
      <div style="font-size:40px;font-weight:800;letter-spacing:10px;color:#2563eb;background:#eff6ff;padding:16px 24px;border-radius:8px;display:inline-block;margin-bottom:24px">
        ${otp}
      </div>
      <p style="color:#64748b;font-size:14px">This code expires in <strong>15 minutes</strong>. If you did not create an account, you can ignore this email.</p>
    </div>
  `;

  if (!transporter) {
    // Development fallback: print OTP to server console
    console.log(`\n========================================`);
    console.log(`📧  Email verification OTP for ${to}`);
    console.log(`    Code: ${otp}`);
    console.log(`========================================\n`);
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || "ARF Map <noreply@arf-map.app>",
    to,
    subject: "Your ARF Map verification code – " + otp,
    html,
  });
}
