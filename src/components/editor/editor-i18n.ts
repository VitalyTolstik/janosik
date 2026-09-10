import type { Translation } from "@mdxeditor/editor";

import { defaultI18n } from "@/i18n/i18n";

/**
 * Bridge between MDXEditor's i18n and the app catalogs.
 *
 * MDXEditor calls `translation(key, defaultValue, interpolations)` with its
 * own keys (`toolbar.bold`, `linkPreview.edit`, …). We namespace them under
 * `editor.*` in `src/locales/{en,ru}/translation.json` and look the key up
 * as a flat literal (our catalogs use dotted literal keys), falling back to
 * the library default so a missing key can never break the editor UI.
 */
export const editorTranslation: Translation = (
  key,
  defaultValue,
  interpolations,
) => {
  // `t` is typed against our app keys — the editor keys are dynamic, so the
  // call goes through an untyped signature on purpose.
  const t = defaultI18n.t as unknown as (
    key: string,
    options?: Record<string, unknown>,
  ) => unknown;
  const resolved = t(`editor.${key}`, {
    defaultValue,
    keySeparator: false,
    nsSeparator: false,
    ...(interpolations ? { replace: interpolations } : null),
  });
  return typeof resolved === "string" ? resolved : defaultValue;
};
