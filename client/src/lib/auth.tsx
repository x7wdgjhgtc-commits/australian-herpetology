import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { setAuthToken, getAuthToken } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import {
  apiLogin,
  apiSignup,
  apiLogout,
  apiMe,
  type AppUser,
} from "@/lib/api";

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AppUser>;
  signup: (input: {
    username: string;
    email: string;
    password: string;
    displayName?: string;
  }) => Promise<AppUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  // We don't have persistent storage in the iframe, so on first load the user
  // is always logged-out. "loading" is brief but we keep it for UX.
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    // If a token already exists (e.g. dev hot reload), validate it.
    if (getAuthToken()) {
      setLoading(true);
      apiMe()
        .then((res) => setUser(res.user))
        .catch(() => {
          setAuthToken(null);
          setUser(null);
        })
        .finally(() => setLoading(false));
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { token, user } = await apiLogin({ email, password });
    setAuthToken(token);
    setUser(user);
    await queryClient.invalidateQueries();
    return user;
  }, []);

  const signup = useCallback(
    async (input: { username: string; email: string; password: string; displayName?: string }) => {
      const { token, user } = await apiSignup(input);
      setAuthToken(token);
      setUser(user);
      await queryClient.invalidateQueries();
      return user;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // ignore
    }
    setAuthToken(null);
    setUser(null);
    await queryClient.invalidateQueries();
  }, []);

  const refresh = useCallback(async () => {
    if (!getAuthToken()) {
      setUser(null);
      return;
    }
    const res = await apiMe();
    setUser(res.user);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, login, signup, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
