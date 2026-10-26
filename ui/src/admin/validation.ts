import type { AdminT } from "./admin-i18n";

/**
 * One validation vocabulary for every admin form (TASK-66 audit): a field
 * declares its rules, `fieldError` returns the first message (localised) or
 * `null`. The same limits live in the backend DTOs — the UI mirrors them so
 * the operator sees the error before the request, the server stays the source
 * of truth.
 */

/** Pragmatic email check — the backend's `@IsEmail` is the real gate. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface FieldRules {
  /** Non-empty after trimming. */
  required?: boolean;
  /** Must look like an email when non-empty. */
  email?: boolean;
  /** Minimum length (counts the raw value). */
  min?: number;
  /** Maximum length (counts the raw value). */
  max?: number;
}

/**
 * The first failing rule for `value`, localised, or `null` when valid.
 * `required`/`email` judge the trimmed value; `min`/`max` the raw length so a
 * trailing space still counts against the limit.
 */
export function fieldError(
  t: AdminT,
  value: string,
  rules: FieldRules,
): string | null {
  const trimmed = value.trim();
  if (rules.required === true && trimmed === "") {
    return t("admin.validation.required");
  }
  if (rules.email === true && trimmed !== "" && !EMAIL_RE.test(trimmed)) {
    return t("admin.validation.email");
  }
  if (rules.min !== undefined && value.length > 0 && value.length < rules.min) {
    return t("admin.validation.tooShort", { min: rules.min });
  }
  if (rules.max !== undefined && value.length > rules.max) {
    return t("admin.validation.tooLong", { max: rules.max });
  }
  return null;
}

/** True when no rule fails. */
export function isValid(t: AdminT, value: string, rules: FieldRules): boolean {
  return fieldError(t, value, rules) === null;
}
