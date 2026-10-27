import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { AuthResponseDto, AuthUserDto } from "@janosik/shared";
import { api, isApiEnabled } from "@/api/client";
import { clearAvatarCache } from "@/hooks/use-avatar-object-url";
import {
  clearImpersonation,
  consumeImpersonationHash,
  getImpersonationToken,
} from "@/impersonation";

/**
 * Session state (TASK-29).
 *
 * Server builds boot by trying `POST /auth/refresh` once (the access token
 * lives in memory, the refresh token rides the httpOnly cookie); until the
 * answer arrives the app shows a splash, then either the login screen or the
 * boards. A session that dies later (rotation/reuse) is reported by the API
 * client through `onAuthLost`, which drops straight back to anonymous — the
 * token and every board in memory go with it.
 *
 * Without an API (the unit-test environment) the provider is a no-op that
 * reports an authenticated local session, so components can be rendered
 * standalone exactly like before TASK-29.
 */

export type AuthStatus = "boot" | "anonymous" | "authenticated";

export interface AuthValue {
  status: AuthStatus;
  user: AuthUserDto | null;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<void>;
  /**
   * Replace the cached profile after a self-service update (TASK-36.1):
   * the `PATCH /users/me` response is the fresh user, so the header avatar
   * and every other consumer see the new name/color at once.
   */
  updateUser: (user: AuthUserDto) => void;
  logout: () => Promise<void>;
  /**
   * Run `task` before logout revokes the session — the board provider
   * drains its command queue here so no pending edit is dropped (U-3).
   * Returns the unregister function.
   */
  registerBeforeLogout?: (task: () => Promise<void>) => () => void;
  /** True while a master "view as" session is active (TASK-59). */
  impersonating?: boolean;
  /** Ends the view-as session and reloads into the master's own session. */
  exitImpersonation?: () => void;
}

const LOCAL_AUTH: AuthValue = {
  status: "authenticated",
  user: null,
  login: async () => {},
  register: async () => {},
  updateUser: () => {},
  logout: async () => {},
  registerBeforeLogout: () => () => {},
  impersonating: false,
  exitImpersonation: () => {},
};

const AuthContext = createContext<AuthValue | null>(null);

/** Exposed for tests that need a signed-in user without a network session. */
export { AuthContext };

export function AuthProvider({ children }: { children: ReactNode }) {
  const serverMode = isApiEnabled();
  const [status, setStatus] = useState<AuthStatus>(() =>
    serverMode ? "boot" : "authenticated",
  );
  const [user, setUser] = useState<AuthUserDto | null>(null);
  const [impersonating, setImpersonating] = useState(false);

  useEffect(() => {
    if (!serverMode) return;
    let cancelled = false;
    // A dead view-as session (TASK-85) must not be refreshed into the master
    // session: clear it and reload into the master's own session instead.
    // While the boot check below confirms a view-as token, its own failure
    // path falls back to the normal session — no reload.
    let confirming = false;
    const onLost = (): void => {
      if (cancelled || confirming) return;
      if (api.isImpersonating()) {
        clearImpersonation();
        window.location.reload();
        return;
      }
      setUser(null);
      setStatus("anonymous");
    };
    api.onAuthLost = onLost;
    // A support "view as" session (TASK-59) wins over the refresh cookie:
    // the impersonation token is adopted for this tab, then `/auth/me`
    // resolves the profile it belongs to. Only a genuine impersonation
    // token on the dedicated route qualifies (U-8, see `impersonation.ts`):
    // the token's own `imp` claim is a first, client-side filter, and the
    // server then confirms it — `/auth/me` names the impersonating master in
    // `impersonatedBy` only for a verified view-as token. Anything else (a
    // forged claim, a normal token, a 401) is dropped and the tab falls back
    // to its own session.
    const impersonationToken =
      getImpersonationToken() ?? consumeImpersonationHash();
    if (impersonationToken !== null) {
      api.setAccessToken(impersonationToken);
      api.setImpersonating(true);
      setImpersonating(true);
      confirming = true;
      void api
        .me()
        .then((profile) => {
          if (
            typeof profile.impersonatedBy !== "string" ||
            profile.impersonatedBy === ""
          ) {
            throw new Error("Not a view-as session");
          }
          confirming = false;
          if (cancelled) return;
          setUser(profile);
          setStatus("authenticated");
        })
        .catch(() => {
          confirming = false;
          if (cancelled) return;
          clearImpersonation();
          api.setImpersonating(false);
          api.clearAccessToken();
          setImpersonating(false);
          void api.refreshSession().then((session) => {
            if (cancelled) return;
            if (session !== null) {
              setUser(session.user);
              setStatus("authenticated");
            } else {
              setStatus("anonymous");
            }
          });
        });
      return () => {
        cancelled = true;
        api.onAuthLost = null;
      };
    }
    void api.refreshSession().then((session) => {
      if (cancelled) return;
      if (session !== null) {
        setUser(session.user);
        setStatus("authenticated");
      } else if (api.getAccessToken() !== null) {
        // The boot refresh was superseded by a login/register that landed
        // while it was in flight — that path already set the session.
      } else {
        setStatus("anonymous");
      }
    });
    return () => {
      cancelled = true;
      api.onAuthLost = null;
    };
  }, [serverMode]);

  const applySession = useCallback((session: AuthResponseDto) => {
    setUser(session.user);
    setStatus("authenticated");
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      applySession(await api.login(email, password));
    },
    [applySession],
  );

  const register = useCallback(
    async (email: string, password: string, displayName?: string) => {
      applySession(await api.register(email, password, displayName));
    },
    [applySession],
  );

  const beforeLogoutRef = useRef(new Set<() => Promise<void>>());
  const registerBeforeLogout = useCallback((task: () => Promise<void>) => {
    const tasks = beforeLogoutRef.current;
    tasks.add(task);
    return () => {
      tasks.delete(task);
    };
  }, []);

  const logout = useCallback(async () => {
    // Pending edits go out while the session is still valid (U-3); a task
    // that fails or hangs must not keep the user from logging out (each one
    // bounds its own wait).
    await Promise.allSettled(
      [...beforeLogoutRef.current].map((task) => task()),
    );
    try {
      await api.logout();
    } catch {
      /* the local session ends whether or not the revoke call landed */
    }
    // TASK-106: drop cached avatar object URLs so a shared browser never
    // keeps the previous account's images.
    clearAvatarCache();
    setUser(null);
    setStatus("anonymous");
  }, []);

  const updateUser = useCallback((next: AuthUserDto) => {
    setUser(next);
  }, []);

  const exitImpersonation = useCallback(() => {
    clearImpersonation();
    api.setImpersonating(false);
    setImpersonating(false);
    // Reloading re-boots the app on the master's own refresh cookie — the
    // cleanest way back, with no half-torn session left in memory.
    window.location.reload();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      login,
      register,
      updateUser,
      logout,
      registerBeforeLogout,
      impersonating,
      exitImpersonation,
    }),
    [
      status,
      user,
      login,
      register,
      updateUser,
      logout,
      registerBeforeLogout,
      impersonating,
      exitImpersonation,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * The session. A component rendered outside `AuthProvider` (standalone
 * component tests) sees the local authenticated session — the pre-TASK-29
 * behaviour, with no network.
 */
export function useAuth(): AuthValue {
  return useContext(AuthContext) ?? LOCAL_AUTH;
}
