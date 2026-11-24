"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearToken,
  fetchMe,
  getToken,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  setToken,
  type AuthUser,
  type RegisterInput,
} from "@/lib/auth";
import { warnIfApiMisconfigured } from "@/lib/api-config";

interface AuthContextValue {
  user: AuthUser | null;
  /** True while the stored token (if any) is being checked on load. */
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  signup: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Auth state for the whole app. The JWT lives in localStorage; on load the
 * token is validated against GET /api/auth/me, and a bad/expired token is
 * discarded so the user lands on the login page instead of a broken state.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Loud console warning if this deploy was built without
    // NEXT_PUBLIC_API_URL (the bundle would then call localhost:4000).
    warnIfApiMisconfigured();
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    fetchMe(token)
      .then(({ user: me }) => setUser(me))
      .catch(() => {
        clearToken();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user: authed, token } = await apiLogin(email, password);
    setToken(token);
    setUser(authed);
    return authed;
  }, []);

  const signup = useCallback(async (input: RegisterInput) => {
    const { user: authed, token } = await apiRegister(input);
    setToken(token);
    setUser(authed);
    return authed;
  }, []);

  const logout = useCallback(async () => {
    const token = getToken();
    if (token) {
      // Best effort: the server is stateless, so logout works even if this
      // call fails — the token is discarded below either way.
      await apiLogout(token).catch(() => undefined);
    }
    clearToken();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, signup, logout }),
    [user, loading, login, signup, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
