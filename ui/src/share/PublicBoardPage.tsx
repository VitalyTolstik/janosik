import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Lock, Sparkles } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";

import type { Board, BoardMemberDto, PublicBoardDto } from "@janosik/shared";
import { boardReducer } from "@janosik/shared";
import { DndBoard } from "@/components/board/DndBoard";
import { useI18n } from "@/i18n";
import { ShareBoardProvider } from "@/store/BoardContext";
import { BoardRealtime } from "@/store/realtime";
import { PublicCardDialog } from "@/share/PublicCardDialog";
import {
  fetchPublicBoard,
  openPublicEvents,
  publicOgUrl,
} from "@/share/share-api";

/**
 * The public read-only board page (TASK-58, §7.9): `/s/:token`.
 *
 * Mounted outside the auth shell, it holds the whole read-only contour — no
 * session, no writes. A snapshot renders its frozen `board`; a live share
 * follows the board over SSE and re-reduces incoming commands, so a demo
 * swarm is visible move-by-move. `?embed=1` drops the chrome for an iframe.
 */
export function PublicBoardPage() {
  const { token = "" } = useParams();
  const [params] = useSearchParams();
  const embed = params.get("embed") === "1";
  const { t } = useI18n();

  const [dto, setDto] = useState<PublicBoardDto | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [status, setStatus] = useState<
    "loading" | "ready" | "gone" | "missing" | "error"
  >("loading");
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  // Load the payload once per token.
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset before the token's payload is fetched
    setStatus("loading");
    fetchPublicBoard(token, controller.signal)
      .then((data) => {
        setDto(data);
        setBoard(data.board);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        const code = (error as { status?: number }).status;
        setStatus(code === 410 ? "gone" : code === 404 ? "missing" : "error");
      });
    return () => controller.abort();
  }, [token]);

  // Sanitized roster in the shape the board components expect (email never
  // exists on the public contour — an empty string is never rendered).
  const members = useMemo<BoardMemberDto[]>(
    () =>
      (dto?.members ?? []).map((member) => ({
        userId: member.id,
        displayName: member.displayName,
        email: "",
        role: "VIEWER" as const,
        expiresAt: null,
        avatarColor: member.avatarColor,
        avatarPath: member.avatarPath,
      })),
    [dto?.members],
  );

  // Live mode: follow the board's commands, read-only.
  const baselineRef = useRef(0);
  useEffect(() => {
    if (dto === null || dto.mode !== "live") return;
    baselineRef.current = dto.seq ?? 0;
    const connection = new BoardRealtime({
      open: (_boardId, since, signal) => openPublicEvents(token, since, signal),
      onEvent: (event) => {
        if (event.type !== "command") return;
        if (event.seq <= baselineRef.current) return;
        baselineRef.current = event.seq;
        setBoard((prev) => {
          if (prev === null) return prev;
          const next = boardReducer([prev], event.action);
          return next[0] ?? prev;
        });
      },
      getSince: () => baselineRef.current,
    });
    connection.watch(dto.board.id);
    return () => connection.stop();
  }, [dto, token]);

  // Meta: title + the messenger preview tags. Client-side only (the API
  // origin owns the OG image); noindex so a link is never crawled.
  useEffect(() => {
    if (board === null) return;
    const previous = document.title;
    document.title = `${board.title} — Janosik`;
    const image = new URL(publicOgUrl(token), window.location.origin).href;
    const metas: Array<[string, string, string]> = [
      ["name", "robots", "noindex, nofollow"],
      ["property", "og:title", board.title],
      ["property", "og:type", "website"],
      ["property", "og:image", image],
      ["property", "og:description", t("share.public.description")],
      ["name", "twitter:card", "summary_large_image"],
    ];
    const created: HTMLMetaElement[] = [];
    for (const [attr, key, content] of metas) {
      let el = document.head.querySelector<HTMLMetaElement>(
        `meta[${attr}="${key}"]`,
      );
      if (el === null) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
        created.push(el);
      }
      el.setAttribute("content", content);
    }
    return () => {
      document.title = previous;
      for (const el of created) el.remove();
    };
  }, [board, token, t]);

  if (status !== "ready" || dto === null || board === null) {
    return (
      <PublicShell embed={embed}>
        <div className="flex flex-1 items-center justify-center p-10 text-muted-foreground">
          {status === "loading" ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          ) : (
            <p className="text-sm" data-testid="share-unavailable">
              {status === "gone"
                ? t("share.public.gone")
                : t("share.public.unavailable")}
            </p>
          )}
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell embed={embed} title={board.title} mode={dto.mode}>
      <ShareBoardProvider board={board} members={members}>
        <DndBoard readOnly onCardClick={(cardId) => setOpenCardId(cardId)} />
        {openCardId !== null ? (
          <PublicCardDialog
            token={token}
            board={board}
            members={members}
            cardId={openCardId}
            includeComments={dto.includeComments}
            includeAttachments={dto.includeAttachments}
            onClose={() => setOpenCardId(null)}
          />
        ) : null}
      </ShareBoardProvider>
    </PublicShell>
  );
}

/** Page chrome: brand, read-only badge and (in embed mode) nothing else. */
function PublicShell({
  embed,
  title,
  mode,
  children,
}: {
  embed: boolean;
  title?: string;
  mode?: "snapshot" | "live";
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {!embed ? (
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary text-primary-foreground shadow-sm">
              <Sparkles className="h-4 w-4" aria-hidden />
            </div>
            <span className="truncate text-sm font-medium">
              {title ?? "Janosik"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            <span>
              {mode === "live"
                ? t("share.public.badgeLive")
                : t("share.public.badge")}
            </span>
          </div>
        </header>
      ) : null}
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
