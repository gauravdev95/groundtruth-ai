// Typed auth client for the Ground Truth AI server.
// Mirrors the server's /api/auth routes (server/src/routes/auth.ts).

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type DbRole = "candidate" | "recruiter" | "admin";

/** Role as chosen on the signup form. "student" is the product word for
 *  the `candidate` role stored in the database. */
export type SignupRole = "student" | "recruiter";

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: DbRole;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
}

export interface ForgotPasswordResponse {
  message: string;
  /** Development only: the server returns the reset link when no mail
   *  sender is configured. Never present in production. */
  resetUrl?: string;
}

const TOKEN_KEY = "gt-auth-token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

/** Human label for a stored role. */
export function roleLabel(role: DbRole): string {
  switch (role) {
    case "candidate":
      return "Student";
    case "recruiter":
      return "Recruiter";
    case "admin":
      return "Admin";
  }
}

/** Initials for the avatar circle, e.g. "Gaurav Yadav" → "GY". */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

interface ErrorBody {
  error?: string;
  message?: string;
}

async function authRequest<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => null)) as ErrorBody | null;
  if (!res.ok) {
    throw new Error(body?.error ?? body?.message ?? `Request failed: ${res.status}`);
  }
  return body as T;
}

export interface RegisterInput {
  email: string;
  password: string;
  full_name: string;
  role: SignupRole;
  company_name?: string;
}

export function register(input: RegisterInput): Promise<AuthResponse> {
  return authRequest<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return authRequest<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function fetchMe(token: string): Promise<{ user: AuthUser }> {
  return authRequest<{ user: AuthUser }>("/api/auth/me", { token });
}

export function logout(token: string): Promise<{ message: string }> {
  return authRequest<{ message: string }>("/api/auth/logout", {
    method: "POST",
    token,
  });
}

export function requestPasswordReset(email: string): Promise<ForgotPasswordResponse> {
  return authRequest<ForgotPasswordResponse>("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(
  token: string,
  new_password: string,
): Promise<{ message: string }> {
  return authRequest<{ message: string }>("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, new_password }),
  });
}
