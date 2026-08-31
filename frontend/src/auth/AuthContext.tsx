/**
 * Sessiebeheer voor de frontend.
 *
 * De sessie zelf zit in een HttpOnly cookie; hier houden we alleen bij wie is
 * ingelogd. Bij een 401 van de API loggen we automatisch uit.
 */

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ApiError, api, setUnauthorizedHandler } from "../api/client";
import type { User } from "../api/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const session = await api.me();
      setUser(session.user);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setUser(null);
      } else {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const session = await api.login(email, password);
    setUser(session.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const context = use(AuthContext);
  if (context === null) {
    throw new Error("useAuth moet binnen een AuthProvider gebruikt worden");
  }
  return context;
}
