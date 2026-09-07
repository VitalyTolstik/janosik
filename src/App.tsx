import { BoardSection } from "@/components/BoardSection";
import { Header } from "@/components/Header";
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
          <TooltipProvider delayDuration={150}>
            <BoardProvider>
              <div className="flex min-h-screen flex-col bg-background text-foreground">
                <Header />
                <BoardSection />
              </div>
            </BoardProvider>
          </TooltipProvider>
        </I18nProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>
  );
}
