import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";

import { BoardSection } from "@/components/BoardSection";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Header } from "@/components/Header";
import { ToastProvider } from "@/components/Toast";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routes } from "@/routes";

/**
 * `/` and any unknown URL render nothing for a frame — the BoardProvider
 * redirects them to the first board (replace, so dead URLs never land in
 * history). `/board/:boardId` is the canonical board address; unknown ids
 * are redirected by the BoardProvider too.
 */
function NoBoardRoute() {
  return null;
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
        <I18nProvider>
          <ToastProvider>
            <ErrorBoundary>
              <TooltipProvider delayDuration={150}>
                <HashRouter>
                  <BoardProvider>
                    <div className="flex min-h-screen flex-col bg-background text-foreground">
                      <Header />
                      <Routes>
                        <Route path={routes.home} element={<NoBoardRoute />} />
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
      </BoardBackgroundProvider>
    </ThemeProvider>
  );
}
