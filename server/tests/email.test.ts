import test from "node:test";
import assert from "node:assert/strict";

// Unit tests for the SMTP email integration (Phase 14) — no mail is sent.
// The live server has no SMTP configured, so the fail-closed path is what
// these tests (and the local run) exercise.
import { emailConfigured } from "../src/config/env";
import { resetPasswordMail, sendMail } from "../src/services/email";

test("emailConfigured() is false without SMTP env vars", () => {
  // The test runner sets no SMTP_* vars, so the service is unconfigured.
  assert.equal(emailConfigured(), false);
});

test("sendMail() fails closed with 503 when SMTP is unconfigured", async () => {
  await assert.rejects(sendMail({ to: "a@example.dev", subject: "x", text: "y" }), (err: unknown) => {
    const e = err as { status?: number; message?: string };
    return e.status === 503 && /not configured/.test(e.message ?? "");
  });
});

test("resetPasswordMail() renders a subject + text + html containing the link", () => {
  const url = "http://localhost:3000/auth/reset-password?token=abc123";
  const mail = resetPasswordMail(url);
  assert.equal(mail.subject, "Reset your GroundTruth password");
  assert.ok(mail.text.includes(url));
  assert.ok(mail.html.includes(url));
  assert.ok(mail.text.includes("30 minutes"));
  // No raw token handling here — the caller supplies the full URL.
  assert.ok(!mail.text.includes("abc123") || mail.text.includes(url));
});
