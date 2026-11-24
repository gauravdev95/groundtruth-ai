"use client";

import { useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Eye, EyeOff, Info, X } from "lucide-react";

/** Inline alert box (error / success / info) in the Stratify card style. */
export function Alert({
  kind,
  children,
}: {
  kind: "error" | "success" | "info";
  children: React.ReactNode;
}) {
  const Icon =
    kind === "error" ? AlertTriangle : kind === "success" ? CheckCircle2 : Info;
  return (
    <div className={`st-alert st-alert-${kind}`} role="alert">
      <Icon size={17} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/** Password input with a show/hide toggle (the old repo's approach: let
 *  users *look* at what they typed instead of retyping it). */
export function PasswordField({
  id,
  name,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  error,
  required,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
  error?: string;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="st-field">
      <label className="st-label" htmlFor={id}>
        {label} {required ? <span className="req" aria-hidden="true">*</span> : null}
      </label>
      <div className="st-pass-wrap">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`st-input${error ? " st-input-error" : ""}`}
        />
        <button
          type="button"
          className="st-pass-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {error ? (
        <span className="st-error-text" id={`${id}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export interface PasswordRules {
  length: boolean;
  upper: boolean;
  lower: boolean;
  digit: boolean;
  special: boolean;
}

/** Live checklist for the server's password policy. */
export function passwordRulesFor(password: string): PasswordRules {
  return {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    digit: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

export function passwordMeetsPolicy(password: string): boolean {
  return Object.values(passwordRulesFor(password)).every(Boolean);
}

export function PasswordChecklist({ password }: { password: string }) {
  const rules = passwordRulesFor(password);
  const items: { ok: boolean; label: string }[] = [
    { ok: rules.length, label: "At least 8 characters" },
    { ok: rules.upper, label: "One uppercase letter" },
    { ok: rules.lower, label: "One lowercase letter" },
    { ok: rules.digit, label: "One number" },
    { ok: rules.special, label: "One special character" },
  ];
  return (
    <div className="st-checks" aria-live="polite">
      {items.map((item) => (
        <span key={item.label} className={`st-check${item.ok ? " ok" : ""}`}>
          {item.ok ? <Check size={14} /> : <X size={14} />}
          {item.label}
        </span>
      ))}
    </div>
  );
}
