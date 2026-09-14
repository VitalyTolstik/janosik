import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Archive, Plus } from "lucide-react";

import { BoardSection } from "@/components/BoardSection";
import { DataSafetyBanner } from "@/components/DataSafetyBanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Header } from "@/components/Header";
import { ToastProvider } from "@/components/Toast";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { I18nProvider } from "@/i18n";
import { BoardProvider, useBoard } from "@/store/BoardContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routes } from "@/routes";
import { useI18n } from "@/i18n";

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
    navigate(routes.board(addBoard(t("board.switcher.new"))));
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
                  <HashRouter>
                    <BoardProvider>
                      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
                        {/* Above the header: a data-at-risk warning outranks
                            everything else on the screen (TASK-21.2). */}
                        <DataSafetyBanner />
                        <Header />
                        <Routes>
                          <Route
                            path={routes.home}
                            element={<NoBoardRoute />}
                          />
                          <Route
                            path={routes.boardPattern}
                            element={<BoardSection />}
                          />
                          <Route path="*" element={<NoBoardRoute />} />
                        </Routes>
                      </div>
                    </BoardProvider>
                  </HashRouter>
                </TooltipProvider>
              </ErrorBoundary>
            </ToastProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>
  );
}
