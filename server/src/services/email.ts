import nodemailer, { type Transporter } from "nodemailer";
import { ApiError } from "../middleware/errorHandler";
import { emailConfigured, env } from "../config/env";

// Outgoing email (Phase 14, 23 Nov 2026) — Nodemailer over plain SMTP.
// Provider-agnostic: any SMTP host works (Gmail, SendGrid, SES, ...), so no
// vendor SDK or new vendor account is baked into the code. Configuration is
// env-only (SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS /
// EMAIL_FROM — see config/env.ts). Credentials are never logged.
//
// Behaviour mirrors the Cloudinary integration: when SMTP is not configured
// the service fails closed with a clear 503 instead of pretending mail was
// sent. NOTHING in this module sends mail at import time; the transport is
// created lazily on first use. Delivery is NOT claimed without a real
// delivery test — that test needs SMTP credentials + Gaurav's approval to
// send to his own address (BLOCKED user step, see the final report).

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!emailConfigured()) {
    throw new ApiError(503, "Email is not configured (SMTP_* env vars missing)");
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: { user: env.smtpUser, pass: env.smtpPass },
    });
  }
  return transporter;
}

export interface MailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Send one email. Throws ApiError(503) when SMTP is unconfigured, and the
 *  underlying Nodemailer error (message only, no credentials) on failure. */
export async function sendMail(options: MailOptions): Promise<void> {
  const transport = getTransporter();
  try {
    await transport.sendMail({
      from: env.emailFrom,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
  } catch (err) {
    // Never log the error object here — some transports include auth
    // material in it. Callers log a short message only.
    throw new ApiError(502, "Failed to send email");
  }
}

/** Password-reset email body. The link is built by the caller (auth route);
 *  this only renders the message so the wording stays in one place. */
export function resetPasswordMail(resetUrl: string): {
  subject: string;
  text: string;
  html: string;
} {
  return {
    subject: "Reset your GroundTruth password",
    text:
      "You asked to reset your GroundTruth password.\n\n" +
      `Open this link to choose a new password (valid for 30 minutes):\n${resetUrl}\n\n` +
      "If you did not ask for this, ignore this email — your password will not change.",
    html:
      "<p>You asked to reset your GroundTruth password.</p>" +
      `<p><a href="${resetUrl}">Choose a new password</a> (valid for 30 minutes).</p>` +
      "<p>If you did not ask for this, ignore this email — your password will not change.</p>",
  };
}
