import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AdminAuthResponseDto, AdminUserDto } from "@janosik/shared";
import { adminApi } from "./admin-client";

/**
 * Master-session state (TASK-36). The same boot dance as the user contour —
 * try one cookie refresh, splash meanwhile, then either the panel or the
 * master login — but on a completely separate token and callback, so a user
 * logout never touches the admin session and vice versa.
 */

export type AdminAuthStatus = "boot" | "anonymous" | "authenticated";

export interface AdminAuthValue {
  status: AdminAuthStatus;
  admin: AdminUserDto | null;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AdminAuthStatus>("boot");
  const [admin, setAdmin] = useState<AdminUserDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi.onAuthLost = () => {
      if (cancelled) return;
      setAdmin(null);
      setStatus("anonymous");
    };
    void adminApi.refreshSession().then((session) => {
      if (cancelled) return;
      if (session !== null) {
        setAdmin(session.admin);
        setStatus("authenticated");
      } else {
        setStatus("anonymous");
      }
    });
    return () => {
      cancelled = true;
      adminApi.onAuthLost = null;
    };
  }, []);

  const applySession = useCallback((session: AdminAuthResponseDto) => {
    setAdmin(session.admin);
    setStatus("authenticated");
  }, []);

  const login = useCallback(
    async (email: string, password: string, totpCode?: string) => {
      applySession(await adminApi.login(email, password, totpCode));
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await adminApi.logout();
    } catch {
      /* the local session ends whether or not the revoke call landed */
    }
    setAdmin(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo<AdminAuthValue>(
    () => ({ status, admin, login, logout }),
    [status, admin, login, logout],
  );

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthValue {
  const value = useContext(AdminAuthContext);
  if (value === null) {
    throw new Error("useAdminAuth must be used inside AdminAuthProvider");
  }
  return value;
}
