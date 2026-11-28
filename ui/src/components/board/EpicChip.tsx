import { cn } from "@/lib/utils";

export interface CardEpicChip {
  code: string;
  title: string;
  completed: boolean;
}

export function EpicChip({
  code,
  title,
  completed,
  showTitle = false,
}: CardEpicChip & { showTitle?: boolean }) {
  return (
    <span
      data-testid="card-epic-chip"
      title={title}
      className={cn(
        "rounded border px-1 text-ui-micro font-semibold",
        showTitle
          ? "inline-flex min-w-0 max-w-full items-center gap-1"
          : "shrink-0",
        completed
          ? "border-border bg-muted text-muted-foreground"
          : "border-(--epic-border) bg-(--epic-surface) text-(--epic-ink)",
      )}
    >
      {showTitle ? (
        <>
          <span className="shrink-0">{code}</span>{" "}
          <span className="min-w-0 truncate">{title}</span>
        </>
      ) : (
        code
      )}
    </span>
  );
}
