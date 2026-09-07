import { useEffect } from "react";

import { BoardSection } from "@/components/BoardSection";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Header } from "@/components/Header";
import { ToastProvider } from "@/components/Toast";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { TooltipProvider } from "@/components/ui/tooltip";

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
                <BoardProvider>
                  <div className="flex min-h-screen flex-col bg-background text-foreground">
                    <Header />
                    <BoardSection />
                  </div>
                </BoardProvider>
              </TooltipProvider>
            </ErrorBoundary>
          </ToastProvider>
        </I18nProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>
  );
}
