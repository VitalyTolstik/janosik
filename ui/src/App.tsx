import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { Archive, Loader2, Plus } from "lucide-react";

import { BoardSection } from "@/components/BoardSection";
import { NotFoundPage } from "@/components/errors/NotFoundPage";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { DataSafetyBanner } from "@/components/DataSafetyBanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Header } from "@/components/Header";
import { UserProfileProvider } from "@/components/board/UserProfileDialog";
import { LoginPage } from "@/components/auth/LoginPage";
import { EmailVerificationGate } from "@/components/auth/EmailVerificationGate";
import { ToastProvider } from "@/components/Toast";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { I18nProvider } from "@/i18n";
import { BoardProvider, useBoard } from "@/store/BoardContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routes } from "@/routes";
import { useI18n } from "@/i18n";
import { APP_BASE } from "@/utils/app-path";

/**
 * The master panel lives on its own route tree and its own chunk: regular
 * users never download it, and neither provider tree can mount the other
 * (TASK-36).
 */
const AdminApp = lazy(() => import("@/admin/AdminApp"));

/**
 * The public read-only board share (TASK-58) is its own lazy chunk, outside
 * the auth shell: an anonymous visitor downloading a link must not pull in
 * the app's session/board machinery.
 */
const PublicBoardPage = lazy(() =>
  import("@/share/PublicBoardPage").then((m) => ({
    default: m.PublicBoardPage,
  })),
);

/**
 * `/` and unknown URLs: the empty-state screen (Trello's boards home).
 * Shown when there are no active boards — nothing yet, or every board
 * archived. Never a dead end: the primary CTA creates a board, and
 * archived boards stay restorable from the header switcher.
 */
export function NoBoardRoute() {
  const { t } = useI18n();
  const { boards, addBoard } = useBoard();
  const navigate = useNavigate();

  const allArchived = boards.length > 0;
  const handleCreate = () => {
    void (async () => {
      const id = await addBoard(t("board.switcher.new"), t("board.untitled"));
      if (id) navigate(routes.board(id));
    })();
  };

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <span
          aria-hidden
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground"
        >
          <Archive className="h-6 w-6" />
        </span>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-foreground">
            {allArchived ? t("board.emptyArchived") : t("board.noBoard")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {allArchived
              ? t("board.emptyArchivedHint")
              : t("board.emptyNewHint")}
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          data-testid="empty-create-board"
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t("board.switcher.new")}
        </button>
      </div>
    </main>
  );
}

/**
 * The board route is keyed by board id, so switching boards remounts
 * `BoardSection`: per-board UI state (the card filter above all) cannot leak
 * from the previous board, whose label ids do not exist here.
 */
function BoardRoute() {
  const { board } = useBoard();
  // The shell only renders once the boards are loaded, so a missing board here
  // is a genuinely unknown id — show the 404 rather than an empty board.
  if (!board) return <NotFoundPage variant="board" />;
  return <BoardSection key={board.id} />;
}

/**
 * The authenticated shell. In server mode the boards are still being
 * fetched on the first paint — showing the empty state then would claim
 * "no boards" when the truth is "not loaded yet", so the shell waits; a
 * failed load (offline boot, server down) offers a retry instead of an
 * empty board list (TASK-29).
 */
function BoardShell() {
  const { board, syncStatus } = useBoard();
  const { t } = useI18n();

  if (syncStatus !== "ready") {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center text-muted-foreground">
          {syncStatus === "loading" ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              <p className="text-sm">{t("sync.loading")}</p>
            </>
          ) : (
            <>
              <p className="text-sm">{t("sync.loadFailed")}</p>
              <button
                type="button"
                data-testid="sync-retry"
                onClick={() => window.location.reload()}
                className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                {t("sync.retry")}
              </button>
            </>
          )}
        </div>
      </main>
    );
  }

  return (
    <>
      {/* Above the header: a data-at-risk warning outranks everything else
          on the screen (TASK-21.2). */}
      <DataSafetyBanner />
      <UserProfileProvider boardId={board?.id}>
        <Header />
        <Routes>
          <Route path={routes.home} element={<NoBoardRoute />} />
          <Route path={routes.boardPattern} element={<BoardRoute />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </UserProfileProvider>
    </>
  );
}

/**
 * Auth gate (TASK-29): the session decides what the shell shows. While the
 * refresh cookie is being checked the app shows a splash instead of
 * flashing the login screen; an anonymous session gets the login screen; an
 * authenticated one mounts the board provider — and unmounts it again on
 * logout, so no board data outlives the session. An authenticated account
 * with an unconfirmed email sees the verification gate instead of the boards
 * (TASK-53) until the code from the signup email is presented.
 */
function AppGate() {
  const { status, user } = useAuth();
  const { t } = useI18n();

  const needsVerification =
    status === "authenticated" && user !== null && user.emailVerifiedAt == null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <ImpersonationBanner />
      {needsVerification ? (
        <EmailVerificationGate />
      ) : status === "authenticated" ? (
        <BoardProvider>
          <AnnouncementBanner />
          <BoardShell />
        </BoardProvider>
      ) : status === "anonymous" ? (
        <LoginPage />
      ) : (
        <main className="flex flex-1 items-center justify-center gap-2 p-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span className="text-sm">{t("auth.restoring")}</span>
        </main>
      )}
    </div>
  );
}

/** Suspense fallback while the master-panel chunk is fetched. */
function RouteSplash() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Loader2
        className="h-5 w-5 animate-spin text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}

export default function App() {
  // First paint is done — drop the preflight kill-switch style (which
  // forced transition:none to avoid a theme-flash) and mark the document
  // as ready so the global color transitions in index.css take effect.
  useEffect(() => {
    document.documentElement.classList.add("__janosik-ready");
    document.getElementById("__janosik_preflight")?.remove();
  }, []);

  return (
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <ToastProvider>
              <ErrorBoundary>
                <TooltipProvider delayDuration={150}>
                  <BrowserRouter basename={APP_BASE.replace(/\/$/, "") || "/"}>
                    <Suspense fallback={<RouteSplash />}>
                      <Routes>
                        <Route
                          path={routes.adminPattern}
                          element={<AdminApp />}
                        />
                        <Route
                          path={routes.sharePattern}
                          element={<PublicBoardPage />}
                        />
                        <Route
                          path="*"
                          element={
                            <AuthProvider>
                              <AppGate />
                            </AuthProvider>
                          }
                        />
                      </Routes>
                    </Suspense>
                  </BrowserRouter>
                </TooltipProvider>
              </ErrorBoundary>
            </ToastProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>
  );
}
