import { useMemo, useRef, useState } from "react";
import { Eye, Globe2, Languages } from "lucide-react";
import {
  ANNOUNCEMENT_LOCALES,
  announcementFallbackNotice,
  announcementFallbackSubjectPrefix,
  completeness,
  resolveAnnouncementContent,
  type AdminAnnouncementDto,
  type AdminCreateAnnouncementRequest,
  type AdminUpdateAnnouncementRequest,
  type AnnouncementFallbackPolicy,
  type AnnouncementLocale,
} from "@janosik/shared";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, useI18n } from "@/i18n";
import { useToast } from "@/components/Toast";
import { adminApi } from "../admin-client";
import { useAdminT, type AdminMessageKey } from "../admin-i18n";
import { Badge, CharCount, Field } from "../ui";
import { RecipientPicker } from "./RecipientPicker";

const TITLE_MAX = 200;
const BODY_MAX = 2000;

interface LocaleText {
  title: string;
  body: string;
}

type EditorTranslations = Record<AnnouncementLocale, LocaleText>;

function emptyTranslations(): EditorTranslations {
  return {
    en: { title: "", body: "" },
    ru: { title: "", body: "" },
  };
}

function initialTranslations(
  announcement: AdminAnnouncementDto | null,
): EditorTranslations {
  const next = emptyTranslations();
  for (const translation of announcement?.translations ?? []) {
    next[translation.locale] = {
      title: translation.title,
      body: translation.body,
    };
  }
  return next;
}

function isLegacyAnnouncement(
  announcement: AdminAnnouncementDto | null,
): boolean {
  return (
    announcement !== null &&
    announcement.sourceLocale === null &&
    (announcement.translations ?? []).length === 0 &&
    (announcement.title.length > 0 || announcement.body.length > 0)
  );
}

/** Epoch ms → `datetime-local` value (`YYYY-MM-DDTHH:MM`), "" when null. */
function toLocalInput(timestamp: number | null): string {
  if (timestamp === null) return "";
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` value → epoch ms; "" → null. */
function fromLocalInput(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The single create/edit dialog for bilingual announcements (EN/RU tabs,
 * completeness, fallback policy, banner + email preview, draft/publish).
 * It uses the shared resolver for previews, so what the admin sees is exactly
 * what the backend will resolve for a viewer of that language.
 */
export function AnnouncementEditorDialog({
  announcement = null,
  onClose,
  onDone,
  readOnly = false,
}: {
  announcement?: AdminAnnouncementDto | null;
  onClose: () => void;
  onDone: () => void;
  /** OPERATOR support view: every control is disabled, no save actions. */
  readOnly?: boolean;
}) {
  const t = useAdminT();
  const toast = useToast();
  const { lang } = useI18n();
  const legacyAtStart = isLegacyAnnouncement(announcement);
  const [initialTranslationsState] = useState<EditorTranslations>(() =>
    initialTranslations(announcement),
  );
  const [translations, setTranslations] = useState<EditorTranslations>(
    initialTranslationsState,
  );
  const [legacy, setLegacy] = useState<LocaleText | null>(() =>
    legacyAtStart
      ? { title: announcement?.title ?? "", body: announcement?.body ?? "" }
      : null,
  );
  const initialSourceLocale =
    announcement?.sourceLocale ?? (announcement ? "" : lang);
  const [sourceLocale, setSourceLocale] = useState<AnnouncementLocale | "">(
    initialSourceLocale,
  );
  const [sourceTouched, setSourceTouched] = useState(false);
  const [fallbackPolicy, setFallbackPolicy] =
    useState<AnnouncementFallbackPolicy>(
      announcement?.fallbackPolicy ?? "require_all",
    );
  const [level, setLevel] = useState<AdminAnnouncementDto["level"]>(
    announcement?.level ?? "info",
  );
  const [audience, setAudience] = useState<AdminAnnouncementDto["audience"]>(
    announcement?.audience ?? "all",
  );
  const [recipients, setRecipients] = useState<string[]>(() =>
    announcement?.audience === "segment" && announcement.segment
      ? announcement.segment
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : [],
  );
  const [sendEmail, setSendEmail] = useState(announcement?.sendEmail ?? false);
  const [startsAt, setStartsAt] = useState(
    toLocalInput(announcement?.startsAt ?? null),
  );
  const [endsAt, setEndsAt] = useState(
    toLocalInput(announcement?.endsAt ?? null),
  );
  const [editorLocale, setEditorLocale] = useState<AnnouncementLocale>(
    initialSourceLocale === "en" || initialSourceLocale === "ru"
      ? initialSourceLocale
      : "en",
  );
  const [previewLocale, setPreviewLocale] = useState<AnnouncementLocale>("en");
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [missingLocales, setMissingLocales] = useState<AnnouncementLocale[]>(
    [],
  );
  const tabRefs = useRef<Record<AnnouncementLocale, HTMLButtonElement | null>>({
    en: null,
    ru: null,
  });
  const [openedAt] = useState(() => Date.now());
  const emailLocked = announcement?.active === true;
  const startTimestamp = fromLocalInput(startsAt);
  const futureStart = startTimestamp !== null && startTimestamp > openedAt;

  const complete = useMemo(
    () =>
      completeness(
        ANNOUNCEMENT_LOCALES.map((locale) => ({
          locale,
          ...translations[locale],
          origin: "human",
        })),
      ),
    [translations],
  );

  const hasContent =
    (legacy !== null &&
      legacy.title.trim() !== "" &&
      legacy.body.trim() !== "") ||
    ANNOUNCEMENT_LOCALES.some(
      (locale) =>
        translations[locale].title.trim() !== "" ||
        translations[locale].body.trim() !== "",
    );
  const hasPartial =
    legacy !== null &&
    (legacy.title.trim() === "") !== (legacy.body.trim() === "");
  const partialLocale = ANNOUNCEMENT_LOCALES.find(
    (locale) =>
      (translations[locale].title.trim() === "") !==
      (translations[locale].body.trim() === ""),
  );

  const localeLabel = (locale: AnnouncementLocale) =>
    t(`admin.comms.lang.${locale}` as AdminMessageKey);

  const focusLocaleTitle = (locale: AnnouncementLocale) => {
    window.requestAnimationFrame(() => {
      document.getElementById(`admin-announcement-title-${locale}`)?.focus();
    });
  };

  const windowInvalid =
    startsAt.trim() !== "" &&
    endsAt.trim() !== "" &&
    (fromLocalInput(startsAt) ?? 0) >= (fromLocalInput(endsAt) ?? 0);

  const blockingReason = (() => {
    if (!hasContent) return t("admin.comms.validation.content");
    if (hasPartial) return t("admin.comms.validation.content");
    if (partialLocale) return t("admin.comms.validation.content");
    if (windowInvalid) return t("admin.comms.validation.window");
    // A legacy row has no known source language yet; the backend keeps its
    // legacy escape hatch until an admin explicitly migrates it.
    if (legacy && sourceLocale === "") return null;
    if (fallbackPolicy === "require_all") {
      const missing = ANNOUNCEMENT_LOCALES.filter(
        (locale) => !complete[locale],
      );
      if (missing.length > 0) {
        return t("admin.comms.validation.missing", {
          locales: missing.map(localeLabel).join(", "),
        });
      }
      return null;
    }
    if (sourceLocale === "") return t("admin.comms.validation.source");
    if (!complete[sourceLocale]) return t("admin.comms.validation.source");
    return null;
  })();

  // A draft only needs one complete language; strict completeness is a
  // publication gate, never a reason to lose an unfinished translation.
  const draftBlockingReason = (() => {
    if (!hasContent) return t("admin.comms.validation.content");
    if (hasPartial) return t("admin.comms.validation.content");
    if (partialLocale) return t("admin.comms.validation.content");
    if (windowInvalid) return t("admin.comms.validation.window");
    if (legacy && sourceLocale === "") return null;
    if (sourceLocale === "" || !complete[sourceLocale]) {
      return t("admin.comms.validation.source");
    }
    return null;
  })();

  const updateTranslation = (
    locale: AnnouncementLocale,
    patch: Partial<LocaleText>,
  ) => {
    const next = {
      ...translations,
      [locale]: { ...translations[locale], ...patch },
    };
    const sourceEmpty =
      sourceLocale === "" ||
      (translations[sourceLocale].title.trim() === "" &&
        translations[sourceLocale].body.trim() === "");
    if (
      !sourceTouched &&
      sourceEmpty &&
      (patch.title?.trim() || patch.body?.trim())
    ) {
      setSourceLocale(locale);
      if (legacy) {
        next[locale] = {
          title: next[locale].title || legacy.title,
          body: next[locale].body || legacy.body,
        };
        setLegacy(null);
      }
    }
    setTranslations(next);
    setMissingLocales((current) => current.filter((entry) => entry !== locale));
    setValidation(null);
  };

  const chooseSource = (value: string) => {
    setSourceTouched(true);
    if (value === "") {
      setSourceLocale("");
      return;
    }
    const locale = value as AnnouncementLocale;
    setSourceLocale(locale);
    if (
      legacy &&
      translations[locale].title.trim() === "" &&
      translations[locale].body.trim() === ""
    ) {
      setTranslations((current) => ({
        ...current,
        [locale]: { title: legacy.title, body: legacy.body },
      }));
      setLegacy(null);
    }
    setValidation(null);
  };

  const buildTranslations = (): Partial<
    Record<AnnouncementLocale, { title: string; body: string } | null>
  > => {
    const payload: Partial<
      Record<AnnouncementLocale, { title: string; body: string } | null>
    > = {};
    for (const locale of ANNOUNCEMENT_LOCALES) {
      const value = translations[locale];
      const before = initialTranslationsState[locale];
      const title = value.title.trim();
      const body = value.body.trim();
      const changed =
        title !== before.title.trim() || body !== before.body.trim();
      if (title !== "" && body !== "" && changed) {
        payload[locale] = { title, body };
      } else if (
        title === "" &&
        body === "" &&
        before.title.trim() !== "" &&
        before.body.trim() !== ""
      ) {
        // Only a version the admin actually cleared is deleted; untouched
        // locales stay absent so another editor's concurrent changes survive
        // this PATCH.
        payload[locale] = null;
      }
    }
    return payload;
  };

  const submit = async (active: boolean) => {
    const reason = active ? blockingReason : draftBlockingReason;
    if (reason !== null) {
      setValidation(reason);
      const firstMissing =
        fallbackPolicy === "require_all" && active
          ? ANNOUNCEMENT_LOCALES.find((locale) => !complete[locale])
          : sourceLocale === ""
            ? undefined
            : sourceLocale;
      if (firstMissing) {
        setEditorLocale(firstMissing);
        focusLocaleTitle(firstMissing);
      }
      return;
    }
    setBusy(true);
    setValidation(null);
    setMissingLocales([]);
    try {
      const common = {
        fallbackPolicy,
        level,
        audience,
        segment: audience === "segment" ? recipients.join(",") : null,
        active,
        sendEmail,
        startsAt: fromLocalInput(startsAt),
        endsAt: fromLocalInput(endsAt),
      };
      const payload: AdminCreateAnnouncementRequest =
        legacy !== null && sourceLocale === ""
          ? {
              ...common,
              title: legacy.title.trim(),
              body: legacy.body.trim(),
            }
          : {
              ...common,
              sourceLocale: sourceLocale === "" ? undefined : sourceLocale,
              translations:
                buildTranslations() as AdminCreateAnnouncementRequest["translations"],
            };
      if (announcement) {
        await adminApi.updateAnnouncement(announcement.id, {
          ...(payload as AdminUpdateAnnouncementRequest),
          version: announcement.version,
        });
      } else {
        await adminApi.createAnnouncement(payload);
      }
      toast.success(
        active
          ? announcement?.active
            ? t("admin.comms.announcementSaved")
            : t("admin.comms.announcementPublished")
          : t("admin.comms.announcementDraftSaved"),
      );
      onClose();
      onDone();
    } catch (cause) {
      if (cause instanceof ApiError) {
        const body = cause.body as { missingLocales?: unknown } | null;
        const missing = Array.isArray(body?.missingLocales)
          ? body.missingLocales.filter(
              (locale): locale is AnnouncementLocale =>
                locale === "en" || locale === "ru",
            )
          : [];
        if (missing.length > 0) {
          setMissingLocales(missing);
          setEditorLocale(missing[0] ?? "en");
          if (missing[0]) focusLocaleTitle(missing[0]);
        }
        const conflict = (body as { conflict?: unknown } | null)?.conflict;
        setValidation(
          conflict === "version"
            ? t("admin.comms.staleAnnouncement")
            : cause.messageText,
        );
      } else {
        setValidation(t("admin.comms.requestFailed"));
      }
    } finally {
      setBusy(false);
    }
  };

  const previewTranslations = useMemo(
    () =>
      ANNOUNCEMENT_LOCALES.map((locale) => ({
        locale,
        ...translations[locale],
        origin: "human",
      })),
    [translations],
  );
  const previewContent = useMemo(
    () =>
      resolveAnnouncementContent({
        requestedLocale: previewLocale,
        sourceLocale: sourceLocale === "" ? null : sourceLocale,
        translations: previewTranslations,
        legacy: legacy ?? { title: null, body: null },
      }),
    [previewLocale, sourceLocale, previewTranslations, legacy],
  );
  const previewMissingLocales =
    legacy && sourceLocale === ""
      ? []
      : fallbackPolicy === "require_all"
        ? ANNOUNCEMENT_LOCALES.filter((locale) => !complete[locale])
        : !sourceLocale || !complete[sourceLocale]
          ? [sourceLocale === "" ? "en" : sourceLocale]
          : [];
  const previewBlocked = previewMissingLocales.length > 0;
  const previewBlockedLocale = previewMissingLocales[0] ?? previewLocale;
  const previewFallback = previewContent?.isFallback ?? false;
  const previewFallbackText = announcementFallbackNotice(
    previewLocale,
    previewContent?.contentLocale ?? null,
  );

  const tab = (locale: AnnouncementLocale) => (
    <button
      key={locale}
      type="button"
      role="tab"
      id={`announcement-tab-${locale}`}
      ref={(element) => {
        tabRefs.current[locale] = element;
      }}
      aria-selected={editorLocale === locale}
      aria-controls={
        editorLocale === locale ? `announcement-panel-${locale}` : undefined
      }
      aria-invalid={missingLocales.includes(locale) || undefined}
      tabIndex={editorLocale === locale ? 0 : -1}
      data-testid={`announcement-tab-${locale}`}
      onClick={() => setEditorLocale(locale)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          const next: AnnouncementLocale = editorLocale === "en" ? "ru" : "en";
          setEditorLocale(next);
          tabRefs.current[next]?.focus();
        }
        if (event.key === "Home") {
          setEditorLocale("en");
          tabRefs.current.en?.focus();
        }
        if (event.key === "End") {
          setEditorLocale("ru");
          tabRefs.current.ru?.focus();
        }
      }}
      className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
        editorLocale === locale
          ? "border-border bg-card text-foreground shadow-sm"
          : "border-transparent text-muted-foreground hover:bg-hover/60 hover:text-foreground"
      } ${
        missingLocales.includes(locale)
          ? "border-danger/60 ring-1 ring-danger/30"
          : ""
      }`}
    >
      <span className="rounded border border-border bg-background/50 px-1.5 py-0.5 font-mono text-[9px] font-bold">
        {t(`admin.comms.lang.${locale}.short` as AdminMessageKey)}
      </span>
      <span className="font-medium">{localeLabel(locale)}</span>
      {sourceLocale === locale ? (
        <Badge variant="primary">{t("admin.comms.source")}</Badge>
      ) : null}
      <span
        aria-hidden
        className={`ml-auto h-1.5 w-1.5 rounded-full ${
          complete[locale] ? "bg-success" : "bg-warning"
        }`}
      />
    </button>
  );

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {announcement
              ? t("admin.comms.announcement.editTitle")
              : t("admin.comms.new")}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {t("admin.comms.announcement.subtitle")}
          </p>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="min-w-0 space-y-3">
            {legacy ? (
              <div
                className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning"
                data-testid="announcement-legacy"
              >
                <p className="flex items-center gap-2 font-medium">
                  <Languages className="h-3.5 w-3.5" aria-hidden />
                  {t("admin.comms.legacy")}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {t("admin.comms.legacy.hint")}
                </p>
                <div className="mt-2 grid gap-2">
                  <Input
                    value={legacy.title}
                    maxLength={TITLE_MAX}
                    disabled={readOnly}
                    aria-label={`${t("admin.comms.field.title")} (${t("admin.comms.legacy")})`}
                    data-testid="admin-announcement-legacy-title"
                    onChange={(event) =>
                      setLegacy((current) =>
                        current
                          ? { ...current, title: event.target.value }
                          : current,
                      )
                    }
                  />
                  <Textarea
                    value={legacy.body}
                    maxLength={BODY_MAX}
                    disabled={readOnly}
                    aria-label={`${t("admin.comms.field.body")} (${t("admin.comms.legacy")})`}
                    data-testid="admin-announcement-legacy-body"
                    onChange={(event) =>
                      setLegacy((current) =>
                        current
                          ? { ...current, body: event.target.value }
                          : current,
                      )
                    }
                  />
                </div>
              </div>
            ) : null}

            <div
              className="flex gap-1 rounded-xl border border-border bg-background/40 p-1"
              role="tablist"
              aria-label={t("admin.comms.languages")}
            >
              {tab("en")}
              {tab("ru")}
            </div>

            <Field
              htmlFor="admin-announcement-source"
              label={t("admin.comms.field.sourceLocale")}
            >
              <select
                id="admin-announcement-source"
                value={sourceLocale}
                disabled={readOnly}
                data-testid="admin-announcement-source"
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                onChange={(event) => chooseSource(event.target.value)}
              >
                {legacy ? (
                  <option value="">{t("admin.comms.legacy.choose")}</option>
                ) : null}
                <option value="en">{t("admin.comms.lang.en")}</option>
                <option value="ru">{t("admin.comms.lang.ru")}</option>
              </select>
            </Field>

            <div
              role="tabpanel"
              id={`announcement-panel-${editorLocale}`}
              aria-labelledby={`announcement-tab-${editorLocale}`}
              className="space-y-3"
            >
              <Field
                htmlFor={`admin-announcement-title-${editorLocale}`}
                label={t("admin.comms.field.title")}
              >
                <Input
                  id={`admin-announcement-title-${editorLocale}`}
                  data-testid={
                    editorLocale === "en"
                      ? "admin-announcement-title"
                      : `admin-announcement-title-${editorLocale}`
                  }
                  value={translations[editorLocale].title}
                  maxLength={TITLE_MAX}
                  disabled={readOnly}
                  aria-invalid={
                    missingLocales.includes(editorLocale) || undefined
                  }
                  onChange={(event) =>
                    updateTranslation(editorLocale, {
                      title: event.target.value,
                    })
                  }
                />
                <CharCount
                  value={translations[editorLocale].title}
                  max={TITLE_MAX}
                />
              </Field>
              <Field
                htmlFor={`admin-announcement-body-${editorLocale}`}
                label={t("admin.comms.field.body")}
              >
                <Textarea
                  id={`admin-announcement-body-${editorLocale}`}
                  data-testid={
                    editorLocale === "en"
                      ? "admin-announcement-body"
                      : `admin-announcement-body-${editorLocale}`
                  }
                  value={translations[editorLocale].body}
                  maxLength={BODY_MAX}
                  disabled={readOnly}
                  aria-invalid={
                    missingLocales.includes(editorLocale) || undefined
                  }
                  onChange={(event) =>
                    updateTranslation(editorLocale, {
                      body: event.target.value,
                    })
                  }
                />
                <CharCount
                  value={translations[editorLocale].body}
                  max={BODY_MAX}
                />
              </Field>
            </div>

            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {ANNOUNCEMENT_LOCALES.map((locale) => (
                <span
                  key={locale}
                  data-testid={`announcement-status-${locale}`}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 ${
                    complete[locale]
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-warning/30 bg-warning/10 text-warning"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full ${
                      complete[locale] ? "bg-success" : "bg-warning"
                    }`}
                  />
                  {t(`admin.comms.lang.${locale}.short` as AdminMessageKey)}{" "}
                  {complete[locale]
                    ? t("admin.comms.ready")
                    : t("admin.comms.notFilled")}
                </span>
              ))}
            </div>

            <div className="rounded-xl border border-border bg-background/30 p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t("admin.comms.policy")}
              </p>
              <label className="flex cursor-pointer gap-2 rounded-lg p-2 text-xs hover:bg-hover/50">
                <input
                  type="radio"
                  name="announcement-policy"
                  value="require_all"
                  checked={fallbackPolicy === "require_all"}
                  disabled={
                    readOnly || (legacy !== null && sourceLocale === "")
                  }
                  data-testid="announcement-policy-require_all"
                  onChange={() => {
                    setFallbackPolicy("require_all");
                    setValidation(null);
                  }}
                  className="mt-0.5 accent-primary"
                />
                <span>
                  <span className="font-medium">
                    {t("admin.comms.policy.require_all")}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                    {t("admin.comms.policy.require_all.hint")}
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer gap-2 rounded-lg p-2 text-xs hover:bg-hover/50">
                <input
                  type="radio"
                  name="announcement-policy"
                  value="allow_fallback"
                  checked={fallbackPolicy === "allow_fallback"}
                  disabled={readOnly}
                  data-testid="announcement-policy-allow_fallback"
                  onChange={() => {
                    setFallbackPolicy("allow_fallback");
                    setValidation(null);
                  }}
                  className="mt-0.5 accent-primary"
                />
                <span>
                  <span className="font-medium">
                    {t("admin.comms.policy.allow_fallback")}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                    {t("admin.comms.policy.allow_fallback.hint")}
                  </span>
                </span>
              </label>
              {fallbackPolicy === "allow_fallback" ? (
                <p className="mt-1 rounded-md border border-primary/20 bg-primary/5 px-2 py-1.5 text-[10px] leading-relaxed text-primary">
                  {t("admin.comms.policy.fallbackExample")}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("admin.comms.field.level")}>
                <select
                  value={level}
                  disabled={readOnly}
                  data-testid="admin-announcement-level"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  onChange={(event) =>
                    setLevel(event.target.value as typeof level)
                  }
                >
                  <option value="info">{t("admin.comms.level.info")}</option>
                  <option value="warning">
                    {t("admin.comms.level.warning")}
                  </option>
                  <option value="danger">
                    {t("admin.comms.level.danger")}
                  </option>
                </select>
              </Field>
              <Field label={t("admin.comms.field.audience")}>
                <select
                  value={audience}
                  disabled={readOnly}
                  data-testid="admin-announcement-audience"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  onChange={(event) =>
                    setAudience(event.target.value as typeof audience)
                  }
                >
                  <option value="all">{t("admin.comms.audience.all")}</option>
                  <option value="segment">
                    {t("admin.comms.audience.segment")}
                  </option>
                </select>
              </Field>
            </div>
            {audience === "segment" ? (
              <RecipientPicker
                recipients={recipients}
                onChange={setRecipients}
                readOnly={readOnly}
              />
            ) : null}

            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={sendEmail}
                onCheckedChange={setSendEmail}
                disabled={emailLocked || readOnly}
                aria-label={t("admin.comms.field.sendEmail")}
                data-testid="admin-announcement-sendemail"
              />
              <span className="text-muted-foreground">
                {t("admin.comms.field.sendEmail")}
              </span>
            </label>
            {emailLocked ? (
              <p
                className="text-[11px] leading-relaxed text-warning"
                data-testid="announcement-email-locked"
              >
                {announcement?.emailSentAt != null
                  ? t("admin.comms.emailSent.hint")
                  : t("admin.comms.emailActiveHint")}
              </p>
            ) : null}
            {!emailLocked && sendEmail && futureStart && startTimestamp ? (
              <p
                role="alert"
                className="rounded-md border border-warning/35 bg-warning/10 px-2 py-1.5 text-[11px] leading-relaxed text-warning"
                data-testid="announcement-email-future-warning"
              >
                {t("admin.comms.emailFutureWarning", {
                  date: formatDate(startTimestamp, lang),
                })}
              </p>
            ) : null}

            <details
              className="rounded-lg border border-border p-3"
              data-testid="announcement-schedule"
            >
              <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                {t("admin.comms.schedule")}
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label={t("admin.comms.field.startsAt")}>
                  <Input
                    type="datetime-local"
                    value={startsAt}
                    disabled={readOnly}
                    data-testid="admin-announcement-starts"
                    onChange={(event) => setStartsAt(event.target.value)}
                  />
                </Field>
                <Field label={t("admin.comms.field.endsAt")}>
                  <Input
                    type="datetime-local"
                    value={endsAt}
                    disabled={readOnly}
                    data-testid="admin-announcement-ends"
                    onChange={(event) => setEndsAt(event.target.value)}
                  />
                </Field>
              </div>
            </details>
          </div>

          <div className="min-w-0 space-y-3 self-start rounded-xl border border-border bg-background/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium">
                  {t("admin.comms.preview.title")}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {t("admin.comms.preview.banner")} ·{" "}
                  {t("admin.comms.preview.email")}
                </p>
              </div>
              <div className="inline-flex rounded-md border border-border p-0.5">
                {ANNOUNCEMENT_LOCALES.map((locale) => (
                  <button
                    key={locale}
                    type="button"
                    data-testid={`announcement-preview-${locale}`}
                    aria-pressed={previewLocale === locale}
                    onClick={() => setPreviewLocale(locale)}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      previewLocale === locale
                        ? "bg-primary/15 text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    {t(`admin.comms.lang.${locale}.short` as AdminMessageKey)}
                  </button>
                ))}
              </div>
            </div>

            {previewBlocked ? (
              <p
                data-testid="announcement-preview-blocked"
                className="flex items-start gap-1.5 rounded-md border border-warning/35 bg-warning/10 p-2 text-[10px] leading-relaxed text-warning"
              >
                <Globe2 className="mt-px h-3 w-3 shrink-0" aria-hidden />
                {t("admin.comms.preview.blocked", {
                  locale: localeLabel(previewBlockedLocale),
                })}
              </p>
            ) : previewContent ? (
              <div
                data-testid="announcement-preview-banner"
                lang={previewContent.contentLocale ?? undefined}
                className="rounded-lg border border-border bg-card p-2.5 shadow-sm"
              >
                {previewFallback ? (
                  <p
                    lang={previewLocale}
                    className="mb-2 flex items-start gap-1.5 rounded border border-primary/25 bg-primary/10 px-1.5 py-1 text-[9px] leading-snug text-primary"
                  >
                    <Globe2
                      className="mt-px h-2.5 w-2.5 shrink-0"
                      aria-hidden
                    />
                    {previewFallbackText}
                  </p>
                ) : null}
                <p className="text-[11px] font-semibold">
                  {previewContent.title}
                </p>
                <p className="mt-1 whitespace-pre-line text-[10px] leading-relaxed text-muted-foreground">
                  {previewContent.body}
                </p>
              </div>
            ) : null}

            {sendEmail ? (
              <div
                data-testid="announcement-preview-email"
                className="rounded-lg border border-border bg-[#eef1f5] p-2"
              >
                <div className="rounded bg-white p-2 text-[#1f2937]">
                  <p className="text-[9px] font-bold text-[#2563eb]">Janosik</p>
                  <p className="mt-1 text-[10px] font-semibold">
                    {t("admin.comms.preview.subject")}:{" "}
                    {previewContent
                      ? `${
                          previewContent.isFallback &&
                          previewContent.contentLocale
                            ? announcementFallbackSubjectPrefix(
                                previewLocale,
                                previewContent.contentLocale,
                              )
                            : ""
                        }${previewContent.title}`
                      : "—"}
                  </p>
                  {previewContent && previewFallback ? (
                    <p
                      lang={previewLocale}
                      className="mt-1 rounded border border-[#fed7aa] bg-[#fff7ed] px-1.5 py-1 text-[9px] leading-snug text-[#9a3412]"
                    >
                      {previewFallbackText}
                    </p>
                  ) : null}
                  <p className="mt-1 whitespace-pre-line text-[9px] leading-relaxed text-[#4b5563]">
                    {previewContent?.body ?? ""}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                {t("admin.comms.preview.noEmail")}
              </p>
            )}
          </div>
        </div>

        {validation !== null ? (
          <p
            role="alert"
            data-testid="announcement-validation"
            className="rounded-md border border-danger/35 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            {validation}
          </p>
        ) : null}

        <DialogFooter className="gap-2">
          {readOnly ? (
            <Button
              size="sm"
              variant="outline"
              data-testid="admin-announcement-close"
              onClick={onClose}
            >
              {t("admin.common.close")}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={onClose}
                disabled={busy}
              >
                {t("admin.common.cancel")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || draftBlockingReason !== null}
                data-testid="admin-announcement-save-draft"
                onClick={() => void submit(false)}
              >
                {t("admin.comms.saveDraft")}
              </Button>
              <Button
                size="sm"
                disabled={busy || blockingReason !== null}
                data-testid={
                  announcement
                    ? "admin-announcement-edit-save"
                    : "admin-announcement-publish"
                }
                onClick={() => void submit(true)}
              >
                <Eye className="h-3.5 w-3.5" aria-hidden />
                {announcement?.active
                  ? t("admin.comms.save")
                  : t("admin.comms.publish")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
