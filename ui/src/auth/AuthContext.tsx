import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AuthResponseDto, AuthUserDto } from "@janosik/shared";
import { api, isApiEnabled } from "@/api/client";

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
}

const LOCAL_AUTH: AuthValue = {
  status: "authenticated",
  user: null,
  login: async () => {},
  register: async () => {},
  updateUser: () => {},
  logout: async () => {},
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

  useEffect(() => {
    if (!serverMode) return;
    let cancelled = false;
    api.onAuthLost = () => {
      if (cancelled) return;
      setUser(null);
      setStatus("anonymous");
    };
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

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* the local session ends whether or not the revoke call landed */
    }
    setUser(null);
    setStatus("anonymous");
  }, []);

  const updateUser = useCallback((next: AuthUserDto) => {
    setUser(next);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, user, login, register, updateUser, logout }),
    [status, user, login, register, updateUser, logout],
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
