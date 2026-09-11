import { Fragment } from "react";

import { splitHighlight } from "@/utils/filter";

interface HighlightedTextProps {
  text: string;
  /** Current query — empty/whitespace disables highlighting. */
  query: string;
}

/**
 * Renders `text` with case-insensitive substring matches wrapped in a
 * `<mark>` (Linear/Notion result style). Pure presentation — the splitting
 * logic lives in `utils/filter.ts` so it is unit-testable.
 */
export function HighlightedText({ text, query }: HighlightedTextProps) {
  return (
    <>
      {splitHighlight(text, query).map((segment, index) =>
        typeof segment === "string" ? (
          <Fragment key={index}>{segment}</Fragment>
        ) : (
          <mark
            key={index}
            className="rounded-[2px] bg-warning/40 px-0.5 text-inherit"
          >
            {segment.text}
          </mark>
        ),
      )}
    </>
  );
}
