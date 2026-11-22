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
  /** Boot refresh hit a transient throttle/outage and is retrying. */
  recovering: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AdminAuthStatus>("boot");
  const [admin, setAdmin] = useState<AdminUserDto | null>(null);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    adminApi.onAuthLost = () => {
      if (cancelled) return;
      setAdmin(null);
      setRecovering(false);
      setStatus("anonymous");
    };

    // QA-A3: a 429 from the refresh throttle is not a logout. Keep the boot
    // screen (the cookie session is still valid) and retry with exponential
    // backoff until the throttle window clears.
    const refresh = async () => {
      try {
        const session = await adminApi.refreshSession();
        if (cancelled) return;
        setRecovering(false);
        if (session !== null) {
          setAdmin(session.admin);
          setStatus("authenticated");
        } else {
          setStatus("anonymous");
        }
      } catch {
        if (cancelled) return;
        setRecovering(true);
        const delay = Math.min(1000 * 2 ** attempt, 15_000);
        attempt += 1;
        timer = setTimeout(() => void refresh(), delay);
      }
    };
    void refresh();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
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
    () => ({ status, admin, recovering, login, logout }),
    [status, admin, recovering, login, logout],
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
