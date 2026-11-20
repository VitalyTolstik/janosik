import { expect, it } from "vitest";

import { copySearchParamsWithoutLanguageHandoff } from "@/utils/search-params";

it("copies query state and removes every language handoff", () => {
  const search = "?keep=1&lng=ru&keep=2&lng=en&empty=";
  const base = new URLSearchParams(search);

  expect(copySearchParamsWithoutLanguageHandoff(search).toString()).toBe(
    "keep=1&keep=2&empty=",
  );
  expect(copySearchParamsWithoutLanguageHandoff(base).toString()).toBe(
    "keep=1&keep=2&empty=",
  );
  expect(base.toString()).toBe(search.slice(1));
});
