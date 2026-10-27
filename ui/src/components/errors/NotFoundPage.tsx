import { Archive } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useI18n } from "@/i18n";
import { routes } from "@/routes";
import { useBoard } from "@/store/BoardContext";

interface NotFoundPageProps {
  /**
   * `board` when a board id in the URL is not in the account's list; `page`
   * for any other unknown URL. Both render the same screen with a different
   * headline.
   */
  variant?: "page" | "board";
}

/**
 * In-app 404. Shown for an unknown URL and for a board id that does not exist
 * (or is not the caller's), instead of silently redirecting to another board —
 * which used to hide typos and stale links. The card motif ties it to the
 * product: the page "left the board".
 */
export function NotFoundPage({ variant = "page" }: NotFoundPageProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { boards } = useBoard();

  const goToBoards = () => {
    const first = boards.find((board) => !board.archivedAt);
    navigate(first ? routes.board(first.id) : routes.home, { replace: true });
  };

  const title =
    variant === "board" ? t("notFound.board.title") : t("notFound.page.title");
  const lead =
    variant === "board" ? t("notFound.board.lead") : t("notFound.page.lead");

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        {/* Decorative: a card that is not on the board. */}
        <div
          aria-hidden
          className="relative w-56 overflow-hidden rounded-xl border border-border/70 bg-card px-4 pt-4 pb-3 text-left shadow-sm"
        >
          <span className="absolute inset-x-0 top-0 h-1.5 bg-danger/70" />
          <div className="flex items-center justify-between gap-2">
            <span className="h-3 w-20 rounded bg-muted-foreground/25" />
            <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-danger uppercase">
              404
            </span>
          </div>
          <div className="mt-2 flex gap-1.5">
            <span className="h-3 w-12 rounded border border-border/60" />
            <span className="h-3 w-16 rounded border border-border/60" />
          </div>
        </div>

        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{lead}</p>
        </div>

        <button
          type="button"
          data-testid="not-found-back"
          onClick={goToBoards}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Archive className="h-4 w-4" aria-hidden />
          {t("notFound.back")}
        </button>
      </div>
    </main>
  );
}
