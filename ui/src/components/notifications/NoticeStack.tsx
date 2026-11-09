import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The single place top-of-page notices stack: centred under the header,
 * 700px wide on desktop and edge-to-edge (with gutters) on phones. The
 * wrapper collapses entirely when every notice is dismissed, so the board
 * does not inherit an empty strip under the header.
 */
export function NoticeStack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-testid="notice-stack"
      className={cn(
        "mx-auto flex w-full max-w-[700px] shrink-0 flex-col gap-[9px] px-4 pt-2 pb-1 empty:hidden sm:px-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
