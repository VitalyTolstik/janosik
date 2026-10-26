import { describe, expect, it } from "vitest";

import en from "./en/translation.json";
import ru from "./ru/translation.json";

/** TASK-121: en and ru must cover the same keys. Plural suffixes (`_one`,
 *  `_few`, …) legitimately differ per language, so compare base keys. */
const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (keys: string[]): Set<string> =>
  new Set(keys.map((key) => key.replace(PLURAL, "")));

describe("i18n parity", () => {
  it("en and ru cover the same base keys", () => {
    const enKeys = base(Object.keys(en));
    const ruKeys = base(Object.keys(ru));
    const missingInRu = [...enKeys].filter((key) => !ruKeys.has(key));
    const missingInEn = [...ruKeys].filter((key) => !enKeys.has(key));
    expect({ missingInRu, missingInEn }).toEqual({
      missingInRu: [],
      missingInEn: [],
    });
  });
});
