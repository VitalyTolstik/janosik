import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Archive, Info, Loader2, Plus, Sparkles } from "lucide-react";
import {
  LIMITS,
  type BoardStarterLocale,
  type BoardTemplateId,
} from "@janosik/shared";

import { BoardSection } from "@/components/BoardSection";
import {
  TemplatePickerDialog,
  type TemplateCreateOutcome,
} from "@/components/board/TemplatePickerDialog";
import { LimitCounter } from "@/components/ui/limit-counter";
import { BoardShellSkeleton } from "@/components/board/BoardSkeleton";
import { BoardSwitcher } from "@/components/board/BoardSwitcher";
import { NotFoundPage } from "@/components/errors/NotFoundPage";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { DataSafetyBanner } from "@/components/DataSafetyBanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Header } from "@/components/Header";
import { NoticeStack } from "@/components/notifications/NoticeStack";
import {
  UpdateAvailabilityProvider,
  UpdatePrompt,
} from "@/components/notifications/UpdatePrompt";
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
import { allBoardsArchived } from "@/utils/board-list";

/**
 * The master panel lives on its own route tree and its own chunk: regular
 * users never download it, and neither provider tree can mount the other
 * (TASK-36).
 */
const AdminApp = lazy(() => import("@/admin/AdminApp"));

/**
 * The agents console spans every board and is not part of the board view
 * bundle; lazy-load it so ordinary board users never download it (TASK-166.13).
 */
const AgentsPage = lazy(() =>
  import("@/components/agents/AgentsPage").then((module) => ({
    default: module.AgentsPage,
  })),
);
const AgentDetailPage = lazy(() =>
  import("@/components/agents/AgentDetailPage").then((module) => ({
    default: module.AgentDetailPage,
  })),
);

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
 * archived boards stay restorable from this screen.
 */
export function NoBoardRoute() {
  const { t, lang } = useI18n();
  const { boards, addBoard, setHomeRedirectPaused } = useBoard();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<"empty" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const submitRef = useRef(false);

  // The provider normally redirects home to the first active board as soon
  // as one exists. Keep the empty state while the picker shows its success
  // panel; closing the picker releases the redirect.
  useEffect(() => {
    if (!pickerOpen) return;
    setHomeRedirectPaused(true);
    return () => setHomeRedirectPaused(false);
  }, [pickerOpen, setHomeRedirectPaused]);

  const allArchived = allBoardsArchived(boards);
  const existingTitles = useMemo(
    () => boards.map((board) => board.title),
    [boards],
  );
  const trimmed = title.trim();
  const canCreate =
    trimmed.length > 0 && trimmed.length <= LIMITS.boardTitle && busy === null;
  // The example supplies its own name, so only a busy empty-board create can
  // disable it. This is deliberately a different flag from `canCreate`.
  const canPickExample = busy === null;
  const templateLocale: BoardStarterLocale = lang.startsWith("ru")
    ? "ru"
    : "en";

  const create = async () => {
    // Two Enter presses (or a click plus Enter) can arrive before the disabled
    // state paints; the ref makes the guard synchronous.
    if (!canCreate || submitRef.current) return;
    submitRef.current = true;
    setBusy("empty");
    try {
      const id = await addBoard(trimmed);
      if (id) navigate(routes.board(id));
    } finally {
      submitRef.current = false;
      setBusy(null);
    }
  };

  const createFromTemplate = (
    name: string,
    template: BoardTemplateId,
    _locale: BoardStarterLocale,
    templateDate: string,
    templateUtcOffsetMinutes: number,
  ): Promise<TemplateCreateOutcome> => {
    // This path must not early-return on `canCreate`: the generated name is
    // already valid and the empty-state field is intentionally untouched.
    if (busy !== null) return Promise.resolve(null);
    return new Promise<TemplateCreateOutcome>((resolve) => {
      const result = addBoard(
        name,
        { template, templateLocale, templateDate, templateUtcOffsetMinutes },
        () => resolve({ code: "template_unavailable" }),
      );
      if (result !== null && typeof result === "object") {
        void result.then(resolve);
        return;
      }
      resolve(result);
    });
  };

  const createEmptyFromPicker = (name: string) => addBoard(name);

  return (
    <main className="flex flex-1 items-center justify-center p-6 max-[620px]:p-4">
      <div className="relative flex w-full max-w-[500px] flex-col items-center text-center">
        <span
          aria-hidden
          className="mb-4 flex h-[54px] w-[54px] items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground shadow-sm"
        >
          <Archive className="h-[23px] w-[23px]" />
        </span>
        <h2 className="mb-[7px] text-[23px] font-semibold leading-tight tracking-[-0.025em] text-foreground">
          {allArchived ? t("board.emptyArchived") : t("board.noBoard")}
        </h2>
        <p className="mx-auto max-w-[360px] text-ui-label leading-[1.55] text-muted-foreground">
          {allArchived ? t("board.emptyArchivedHint") : t("board.emptyNewHint")}
        </p>

        <form
          noValidate
          className="mt-[18px] w-full rounded-[15px] border border-border bg-card p-[17px] text-left shadow-md"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <div className="mb-1.5 flex items-center gap-[7px]">
            <label
              htmlFor="first-board-name"
              className="text-ui-label font-semibold text-foreground"
            >
              {t("board.firstRun.nameLabel")}
            </label>
            <span className="rounded-[4px] border border-border px-1.5 py-px text-ui-micro font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              {t("board.firstRun.nameOptional")}
            </span>
          </div>
          <div className="relative">
            {/* Keep touch inputs at 16px to prevent iOS focus zoom. */}
            <input
              id="first-board-name"
              name="board-title"
              value={title}
              maxLength={LIMITS.boardTitle}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("board.firstRun.placeholder")}
              aria-describedby="first-board-name-help first-board-name-status"
              data-testid="empty-board-name"
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-ui-body text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground hover:border-muted-foreground/40 focus:border-primary focus:ring-[3px] focus:ring-primary/20 max-[1024.98px]:text-base"
            />
            <LimitCounter
              length={title.length}
              limit={LIMITS.boardTitle}
              position="static"
              testId="empty-board-limit"
            />
          </div>
          <p
            id="first-board-name-help"
            className="mt-1.5 text-ui-body leading-[1.45] text-muted-foreground"
          >
            {t("board.firstRun.nameHelper")}
          </p>
          <div className="mt-3 flex gap-2 max-[620px]:flex-col">
            <button
              type="button"
              disabled={!canPickExample}
              onClick={() => setPickerOpen(true)}
              data-testid="empty-create-template"
              className="inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-action-primary px-3.5 text-ui-body font-medium text-primary-foreground shadow-sm transition-colors hover:bg-[#1d4ed8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-50 max-[620px]:w-full max-[620px]:flex-none"
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              {t("board.firstRun.starterCta")}
            </button>
            <button
              type="submit"
              disabled={!canCreate}
              data-testid="empty-create-board"
              className="inline-flex h-11 min-w-[234px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border bg-card px-3.5 text-ui-body font-medium text-foreground transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-50 max-[620px]:w-full max-[620px]:flex-none"
            >
              {busy === "empty" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-4 w-4" aria-hidden />
              )}
              {busy === "empty"
                ? t("board.firstRun.creating")
                : t("board.firstRun.emptyCta")}
            </button>
          </div>
          <p
            id="first-board-name-status"
            className="mt-2.5 flex items-start gap-1 text-ui-body leading-[1.5] text-muted-foreground"
          >
            <Info
              aria-hidden
              className="mt-0.5 h-3 w-3 shrink-0 text-primary"
            />
            {trimmed.length > 0
              ? t("board.firstRun.exampleHint")
              : t("board.firstRun.emptyDisabledHint")}
          </p>
        </form>
        <p className="mt-3.5 text-ui-meta text-muted-foreground">
          {t("board.firstRun.footHint")}
        </p>
        {allArchived ? <BoardSwitcher archivedEntry /> : null}
      </div>
      <TemplatePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        existingTitles={existingTitles}
        initialName={title}
        createBoard={createFromTemplate}
        createEmptyBoard={createEmptyFromPicker}
        onOpenBoard={(boardId) => navigate(routes.board(boardId))}
      />
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
 * Every top-of-page message in the authenticated app, in priority order.
 * One component so the loading screen and the ready shell cannot drift into
 * two different stacks.
 */
function BoardNotices() {
  return (
    <NoticeStack>
      <ImpersonationBanner />
      <AnnouncementBanner />
      <DataSafetyBanner />
      <UpdatePrompt variant="inline" />
    </NoticeStack>
  );
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

  if (syncStatus === "loading") {
    return (
      <>
        <BoardNotices />
        <BoardShellSkeleton />
      </>
    );
  }

  if (syncStatus === "error") {
    return (
      <>
        <BoardNotices />
        <main className="flex flex-1 items-center justify-center p-6">
          <div className="flex max-w-sm flex-col items-center gap-3 text-center text-muted-foreground">
            <p className="text-ui-body">{t("sync.loadFailed")}</p>
            <button
              type="button"
              data-testid="sync-retry"
              onClick={() => window.location.reload()}
              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-ui-body font-medium text-primary-foreground shadow-sm transition-colors hover:bg-[#1d4ed8]"
            >
              {t("sync.retry")}
            </button>
          </div>
        </main>
      </>
    );
  }

  return (
    <UserProfileProvider boardId={board?.id}>
      <Header />
      {/* The single notification surface: topbar → notices → board. Every
          top-of-page message lives here, so none of them can cover the
          header or fight another banner for the same corner. */}
      <BoardNotices />
      <Routes>
        <Route path={routes.home} element={<NoBoardRoute />} />
        <Route path={routes.boardPattern} element={<BoardRoute />} />
        <Route path={routes.agents} element={<AgentsPage />} />
        <Route path={routes.agentPattern} element={<AgentDetailPage />} />
        {/* The support "view as" entry (U-8): the token was taken from
            the hash at boot; the session lands on the home redirect. */}
        <Route
          path={routes.impersonate}
          element={<Navigate to={routes.home} replace />}
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </UserProfileProvider>
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
  const location = useLocation();
  const { t } = useI18n();

  const needsVerification =
    status === "authenticated" && user !== null && user.emailVerifiedAt == null;

  if (status === "authenticated") {
    const params = new URLSearchParams(location.search);
    if (params.has("mode")) {
      params.delete("mode");
      return (
        <Navigate
          to={{
            pathname: location.pathname,
            search: params.toString(),
            hash: location.hash,
          }}
          state={location.state}
          replace
        />
      );
    }
  }

  if (status === "authenticated" && !needsVerification) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <BoardProvider>
          <BoardShell />
        </BoardProvider>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {needsVerification ? (
        <>
          {/* No header yet, but the support session still has to be visible. */}
          <NoticeStack>
            <ImpersonationBanner />
          </NoticeStack>
          <EmailVerificationGate />
        </>
      ) : status === "anonymous" ? (
        <LoginPage />
      ) : (
        <main
          data-testid="app-boot-splash"
          className="flex flex-1 items-center justify-center gap-2 p-6 text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span className="text-ui-body">{t("auth.restoring")}</span>
        </main>
      )}
      {/* Login, verification and the boot splash have no notice stack; this
          compact floating copy is the single fallback for those screens. */}
      <UpdatePrompt />
    </div>
  );
}

/** Suspense fallback while the master-panel chunk is fetched. */
function RouteSplash() {
  return (
    <div
      data-testid="route-splash"
      className="flex h-screen items-center justify-center bg-background"
    >
      <Loader2
        className="h-5 w-5 animate-spin text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}

export function createAppRouter() {
  // Hosts can serve the SPA directly from the bare base. Canonicalize it
  // before the router starts so root links and URL cleanup keep the slash.
  const { pathname, search, hash } = window.location;
  if (APP_BASE !== "/" && pathname === APP_BASE.replace(/\/$/, "")) {
    window.history.replaceState(
      window.history.state,
      "",
      APP_BASE + search + hash,
    );
  }

  return createBrowserRouter(
    [
      {
        path: "*",
        element: (
          <UpdateAvailabilityProvider>
            <Suspense fallback={<RouteSplash />}>
              <Routes>
                <Route
                  path={routes.adminPattern}
                  element={
                    <>
                      <AdminApp />
                      {/* No notice stack in the master panel — the
                                    compact fallback is the only copy. */}
                      <UpdatePrompt />
                    </>
                  }
                />
                <Route
                  path={routes.sharePattern}
                  element={
                    <>
                      <PublicBoardPage />
                      <UpdatePrompt />
                    </>
                  }
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
          </UpdateAvailabilityProvider>
        ),
      },
    ],
    { basename: APP_BASE },
  );
}

export default function App({
  router,
}: {
  router: ReturnType<typeof createAppRouter>;
}) {
  // First paint is done — drop the preflight kill-switch style (which
  // forced transition:none to avoid a theme-flash) and mark the document
  // as ready so the global color transitions in index.css take effect.
  useEffect(() => {
    document.documentElement.classList.add("__janosik-ready");
    document.getElementById("__janosik_preflight")?.remove();
  }, []);

  // Input modality (TASK-31): on touch, a tap focuses an icon-only header
  // button and its tooltip stays open over the neighbouring controls — the
  // bubble then intercepts the next tap. CSS hides tooltips while the last
  // pointer was touch; a mouse pointer flips the marker back.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      document.documentElement.dataset.input =
        event.pointerType === "mouse" ? "mouse" : "touch";
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  return (
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <ToastProvider>
              <ErrorBoundary>
                <TooltipProvider delayDuration={150}>
                  <RouterProvider router={router} />
                </TooltipProvider>
              </ErrorBoundary>
            </ToastProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>
  );
}
