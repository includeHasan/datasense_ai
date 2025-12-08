"use client";

import * as React from "react";
import Cookies from "js-cookie";

import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import type { AuthUser } from "@/lib/types";

const TOKEN_COOKIE = "ds_token";
const TOKEN_COOKIE_EXPIRY_DAYS = 7;

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(
  undefined
);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(
    () => Cookies.get(TOKEN_COOKIE) !== undefined
  );

  React.useEffect(() => {
    const cookieToken = Cookies.get(TOKEN_COOKIE);

    if (!cookieToken) {
      return;
    }

    let cancelled = false;

    api
      .me(cookieToken)
      .then(({ user: hydratedUser }) => {
        if (cancelled) return;
        setToken(cookieToken);
        setUser(hydratedUser);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          Cookies.remove(TOKEN_COOKIE);
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = React.useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    Cookies.set(TOKEN_COOKIE, result.token, {
      expires: TOKEN_COOKIE_EXPIRY_DAYS,
    });
    setToken(result.token);
    setUser(result.user);
  }, []);

  const register = React.useCallback(
    async (email: string, password: string) => {
      const result = await api.register(email, password);
      Cookies.set(TOKEN_COOKIE, result.token, {
        expires: TOKEN_COOKIE_EXPIRY_DAYS,
      });
      setToken(result.token);
      setUser(result.user);
    },
    []
  );

  const logout = React.useCallback(() => {
    Cookies.remove(TOKEN_COOKIE);
    setToken(null);
    setUser(null);
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({ user, token, login, register, logout, isLoading }),
    [user, token, login, register, logout, isLoading]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
