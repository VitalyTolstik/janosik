import { base, withBase } from "../utils/url";
import { defaultLang, languages, ui, type Lang, type UIKey } from "./ui";

function isLang(value: string): value is Lang {
  return value in languages;
}

/** Resolve the active language from a URL, honouring the deploy base. */
export function getLangFromUrl(url: URL): Lang {
  const path = url.pathname.startsWith(base)
    ? url.pathname.slice(base.length)
    : url.pathname;
  const segment = path.split("/").filter(Boolean)[0];
  return segment !== undefined && isLang(segment) ? segment : defaultLang;
}

/** A translator bound to one language. */
export function useTranslations(lang: Lang) {
  return function t(key: UIKey): string {
    return ui[lang][key];
  };
}

/**
 * Strip the deploy base and any locale prefix from a pathname, returning a
 * base-less, locale-less absolute path with a trailing slash (`/#features`
 * keeps its anchor).
 */
export function stripLocale(pathname: string): string {
  const withoutBase = pathname.startsWith(base)
    ? pathname.slice(base.length)
    : pathname;
  const segments = withoutBase.split("/").filter(Boolean);
  if (segments[0] !== undefined && isLang(segments[0])) segments.shift();
  const joined = segments.join("/");
  return "/" + (joined === "" ? "" : joined + "/");
}

/**
 * Prefix a base-less path with the language segment (`/pricing` →
 * `/ru/pricing/`), normalising the trailing slash and preserving anchors.
 */
export function localizePath(path: string, lang: Lang): string {
  const [pathname, ...suffix] = path.split(/(?=[#?])/);
  const clean = pathname.replace(/^\/+/, "");
  const localized = lang === defaultLang ? `/${clean}` : `/${lang}/${clean}`;
  const trailing = localized.endsWith("/") ? localized : `${localized}/`;
  return trailing + suffix.join("");
}

/** A full, base-aware, language-aware href for an internal path. */
export function localizedUrl(path: string, lang: Lang): string {
  return withBase(localizePath(path, lang));
}

/** The equivalent path in the other language, for the language switcher. */
export function switchLangUrl(pathname: string, lang: Lang): string {
  return localizedUrl(stripLocale(pathname), lang);
}
