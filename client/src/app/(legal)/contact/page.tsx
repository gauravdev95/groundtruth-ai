"use client";

import { useState, type FormEvent } from "react";
import { LegalShell } from "../LegalShell";
import { submitContact } from "@/lib/api";

// NOTE: this file is a client component, so `metadata` cannot be exported
// from it; the page title is set by the layout's defaults. Keep the copy
// honest: the form stores the message for the team — no email is sent
// automatically, because no SMTP is configured.
export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const res = await submitContact({
        name,
        email,
        message,
        source: "contact_page",
      });
      setDone(res.message);
      setName("");
      setEmail("");
      setMessage("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not send your message. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <LegalShell
      eyebrow="Get in touch"
      title="Contact us"
      updated="We read every message — replies come from the team, by email."
      current="/contact"
    >
      <p>
        Questions about GroundTruth AI, a data request under the DPDP Act, or
        a report that a score looks wrong? Send it here. Your message is
        stored for the team to review and reply to — no automated email is
        sent from this form.
      </p>
      {done ? (
        <p className="legal-success" role="status">
          {done}
        </p>
      ) : (
        <form className="legal-form" onSubmit={onSubmit}>
          <label>
            Your name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
              placeholder="Your full name"
              autoComplete="name"
            />
          </label>
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={320}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <label>
            Message
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              maxLength={5000}
              placeholder="How can we help?"
            />
          </label>
          {error ? (
            <p className="legal-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="legal-btn" disabled={busy}>
            {busy ? "Sending…" : "Send message"}
          </button>
        </form>
      )}
    </LegalShell>
  );
}
