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
import { ApiError } from "@/api/client";
import { adminApi, withAdminRequestTimeout } from "./admin-client";

/**
 * Master-session state (TASK-36). The same boot dance as the user contour —
 * try one cookie refresh, splash meanwhile, then either the panel or the
 * master login — but on a completely separate token and callback, so a user
 * logout never touches the admin session and vice versa.
 */

export type AdminAuthStatus = "boot" | "anonymous" | "authenticated";

/** Why the boot refresh is being retried (QA review: distinct copy). */
export type AdminAuthRecovery = "rateLimited" | "unavailable";

/** Initial refresh plus three backoff retries, then a manual choice. */
const MAX_BOOT_REFRESH_ATTEMPTS = 4;

export interface AdminAuthValue {
  status: AdminAuthStatus;
  admin: AdminUserDto | null;
  /** Boot refresh hit a transient throttle or outage and is retrying. */
  recovering: AdminAuthRecovery | null;
  /** Automatic retries are exhausted; the user can retry or sign in. */
  recoveryFailed: AdminAuthRecovery | null;
  retryRefresh: () => void;
  signIn: () => void;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AdminAuthStatus>("boot");
  const [admin, setAdmin] = useState<AdminUserDto | null>(null);
  const [recovering, setRecovering] = useState<AdminAuthRecovery | null>(null);
  const [recoveryFailed, setRecoveryFailed] =
    useState<AdminAuthRecovery | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    adminApi.onAuthLost = () => {
      if (cancelled) return;
      setAdmin(null);
      setRecovering(null);
      setRecoveryFailed(null);
      setStatus("anonymous");
    };

    // QA-A3: a 429 from the refresh throttle is not a logout. Keep the boot
    // screen (the cookie session is still valid) and retry with exponential
    // backoff. Retries are bounded; after that the gate offers Retry and a
    // deliberate sign-in instead of spinning forever.
    const refresh = async () => {
      try {
        const session = await withAdminRequestTimeout((signal) =>
          adminApi.refreshSession({ signal }),
        );
        if (cancelled) return;
        setRecovering(null);
        setRecoveryFailed(null);
        if (session !== null) {
          setAdmin(session.admin);
          setStatus("authenticated");
        } else {
          setStatus("anonymous");
        }
      } catch (error) {
        if (cancelled) return;
        const kind: AdminAuthRecovery =
          error instanceof ApiError && error.status === 429
            ? "rateLimited"
            : "unavailable";
        if (attempt >= MAX_BOOT_REFRESH_ATTEMPTS - 1) {
          setRecovering(null);
          setRecoveryFailed(kind);
          return;
        }
        setRecovering(kind);
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
  }, [refreshNonce]);

  const retryRefresh = useCallback(() => {
    setRecovering(null);
    setRecoveryFailed(null);
    setStatus("boot");
    setRefreshNonce((nonce) => nonce + 1);
  }, []);

  const signIn = useCallback(() => {
    setAdmin(null);
    setRecovering(null);
    setRecoveryFailed(null);
    setStatus("anonymous");
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
    setRecovering(null);
    setRecoveryFailed(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo<AdminAuthValue>(
    () => ({
      status,
      admin,
      recovering,
      recoveryFailed,
      retryRefresh,
      signIn,
      login,
      logout,
    }),
    [
      status,
      admin,
      recovering,
      recoveryFailed,
      retryRefresh,
      signIn,
      login,
      logout,
    ],
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
