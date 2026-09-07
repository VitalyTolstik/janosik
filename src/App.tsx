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
