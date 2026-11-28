import { Fragment } from "react";

/**
 * Renders text with quiet break opportunities after the characters that
 * naturally split an account address (`@`, `.`, `-`, `_`). A long email in
 * the People roster or the card peek then wraps between its parts instead of
 * tearing through the middle of a token, while the DOM text stays identical
 * (a `<wbr>` adds no character to copy/paste or the accessible name).
 */
export function BreakableText({ text }: { text: string }) {
  const parts = text.split(/([@._-])/u);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <Fragment key={index}>
            {part}
            <wbr />
          </Fragment>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
