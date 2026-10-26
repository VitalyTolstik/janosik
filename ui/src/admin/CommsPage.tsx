import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AdminEmailTemplateDto, AdminUserRowDto } from "@janosik/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/Toast";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import {
  Badge,
  CharCount,
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
} from "./ui";

/** Length caps mirroring the backend DTOs (AdminCreateAnnouncementDto / email). */
const TITLE_MAX = 200;
const BODY_MAX = 2000;
const SUBJECT_MAX = 200;
const BODY_HTML_MAX = 20000;

/**
 * Communications (TASK-62): compose a broadcast (in-app banner, optional
 * email) to everyone or hand-picked users, send a one-off letter, edit the
 * mail templates. The full announcement history is its own entity page
 * (`/admin/announcements`) — this page just points there.
 */
export function CommsPage() {
  const t = useAdminT();
  const toast = useToast();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [templates, setTemplates] = useState<AdminEmailTemplateDto[]>([]);

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [level, setLevel] = useState<"info" | "warning" | "danger">("info");
  const [audience, setAudience] = useState<"all" | "segment">("all");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);

  const [mailTo, setMailTo] = useState("");
  const [mailSubject, setMailSubject] = useState("");
  const [mailBody, setMailBody] = useState("");
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState<
    Record<string, { subject: string; bodyHtml: string }>
  >({});

  const load = useCallback(() => {
    adminApi
      .listEmailTemplates()
      .then((nextTemplates) => {
        setTemplates(nextTemplates);
        setDraft(
          Object.fromEntries(
            nextTemplates.map((entry) => [
              entry.key,
              { subject: entry.subject, bodyHtml: entry.bodyHtml },
            ]),
          ),
        );
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setTitle("");
    setBody("");
    setLevel("info");
    setAudience("all");
    setRecipients([]);
    setSendEmail(false);
  };

  const create = useCallback(async () => {
    setBusy(true);
    try {
      await adminApi.createAnnouncement({
        title,
        body,
        level,
        audience,
        segment: audience === "segment" ? recipients.join(",") : null,
        sendEmail,
      });
      toast.success(t("admin.comms.created"));
      setCreating(false);
      resetForm();
      load();
    } catch {
      toast.error(t("admin.common.actionFailed"));
    } finally {
      setBusy(false);
    }
  }, [title, body, level, audience, recipients, sendEmail, load, t, toast]);

  const send = useCallback(async () => {
    setSending(true);
    try {
      const result = await adminApi.sendEmail({
        to: mailTo,
        subject: mailSubject,
        body: mailBody,
      });
      if (result.ok) {
        toast.success(t("admin.comms.sent"));
        setMailTo("");
        setMailSubject("");
        setMailBody("");
      } else {
        toast.error(result.error ?? t("admin.common.actionFailed"));
      }
    } catch {
      toast.error(t("admin.common.actionFailed"));
    } finally {
      setSending(false);
    }
  }, [mailTo, mailSubject, mailBody, t, toast]);

  // Keep the roster row and its editable draft in step after save/reset.
  const applyTemplate = useCallback((updated: AdminEmailTemplateDto) => {
    setTemplates((current) =>
      current.map((row) => (row.key === updated.key ? updated : row)),
    );
    setDraft((current) => ({
      ...current,
      [updated.key]: { subject: updated.subject, bodyHtml: updated.bodyHtml },
    }));
  }, []);

  const saveTemplate = useCallback(
    async (key: string) => {
      const entry = draft[key];
      if (!entry) return;
      try {
        const updated = await adminApi.updateEmailTemplate(key, entry);
        applyTemplate(updated);
        toast.success(t("admin.comms.saved"));
      } catch {
        toast.error(t("admin.common.actionFailed"));
      }
    },
    [draft, t, toast],
  );

  const resetTemplate = useCallback(
    async (key: string) => {
      try {
        const updated = await adminApi.resetEmailTemplate(key);
        applyTemplate(updated);
        toast.success(t("admin.comms.templates.resetDone"));
      } catch {
        toast.error(t("admin.common.actionFailed"));
      }
    },
    [t, toast],
  );

  if (phase === "loading") return <LoadingState />;
  if (phase === "error") {
    return (
      <ErrorState
        onRetry={() => {
          setPhase("loading");
          load();
        }}
      />
    );
  }

  return (
    <div className="w-full max-w-4xl space-y-4 p-4">
      <PageHeader
        title={t("admin.comms.title")}
        subtitle={t("admin.comms.subtitle")}
      />

      <Panel className="flex items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-sm font-medium">
            {t("admin.comms.announcements")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("admin.comms.announcements.hint")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to="/admin/announcements">
              {t("admin.announcements.title")}
            </Link>
          </Button>
          <Button
            size="sm"
            data-testid="admin-announcement-new"
            onClick={() => setCreating(true)}
          >
            {t("admin.comms.new")}
          </Button>
        </div>
      </Panel>

      <Panel className="p-4">
        <h2 className="mb-3 text-sm font-medium">
          {t("admin.comms.email.title")}
        </h2>
        <div className="grid gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              {t("admin.comms.email.to")}
            </span>
            <Input
              value={mailTo}
              data-testid="admin-email-to"
              onChange={(event) => setMailTo(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              {t("admin.comms.email.subject")}
            </span>
            <Input
              value={mailSubject}
              maxLength={SUBJECT_MAX}
              data-testid="admin-email-subject"
              onChange={(event) => setMailSubject(event.target.value)}
            />
            <CharCount value={mailSubject} max={SUBJECT_MAX} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              {t("admin.comms.email.body")}
            </span>
            <Textarea
              value={mailBody}
              maxLength={BODY_HTML_MAX}
              data-testid="admin-email-body"
              onChange={(event) => setMailBody(event.target.value)}
            />
            <CharCount value={mailBody} max={BODY_HTML_MAX} />
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            disabled={sending}
            data-testid="admin-email-send"
            onClick={() => void send()}
          >
            {t("admin.comms.email.send")}
          </Button>
        </div>
      </Panel>

      <Panel className="p-4">
        <h2 className="mb-3 text-sm font-medium">
          {t("admin.comms.templates.title")}
        </h2>
        <div className="space-y-4">
          {templates.map((template) => (
            <div key={template.key} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{template.label}</p>
                {template.custom ? (
                  <Badge variant="primary">{t("admin.comms.custom")}</Badge>
                ) : (
                  <Badge variant="neutral">{t("admin.comms.default")}</Badge>
                )}
                {template.placeholders.length > 0 ? (
                  <span className="text-[11px] text-muted-foreground">
                    {t("admin.comms.templates.placeholders", {
                      list: template.placeholders
                        .map((name) => `{{${name}}}`)
                        .join(", "),
                    })}
                  </span>
                ) : null}
              </div>
              <Input
                value={draft[template.key]?.subject ?? ""}
                maxLength={SUBJECT_MAX}
                placeholder={t("admin.comms.templates.subject")}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [template.key]: {
                      subject: event.target.value,
                      bodyHtml: current[template.key]?.bodyHtml ?? "",
                    },
                  }))
                }
              />
              <CharCount
                value={draft[template.key]?.subject ?? ""}
                max={SUBJECT_MAX}
              />
              <Textarea
                value={draft[template.key]?.bodyHtml ?? ""}
                maxLength={BODY_HTML_MAX}
                placeholder={t("admin.comms.templates.body")}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [template.key]: {
                      subject: current[template.key]?.subject ?? "",
                      bodyHtml: event.target.value,
                    },
                  }))
                }
              />
              <div className="flex justify-end gap-2">
                {template.custom ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`admin-template-reset-${template.key}`}
                    onClick={() => void resetTemplate(template.key)}
                  >
                    {t("admin.comms.templates.reset")}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  data-testid={`admin-template-save-${template.key}`}
                  onClick={() => void saveTemplate(template.key)}
                >
                  {t("admin.common.save")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Dialog
        open={creating}
        onOpenChange={(next) => {
          if (!next) {
            setCreating(false);
            resetForm();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.comms.new")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">
                {t("admin.comms.field.title")}
              </span>
              <Input
                value={title}
                maxLength={TITLE_MAX}
                data-testid="admin-announcement-title"
                onChange={(event) => setTitle(event.target.value)}
              />
              <CharCount value={title} max={TITLE_MAX} />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">
                {t("admin.comms.field.body")}
              </span>
              <Textarea
                value={body}
                maxLength={BODY_MAX}
                data-testid="admin-announcement-body"
                onChange={(event) => setBody(event.target.value)}
              />
              <CharCount value={body} max={BODY_MAX} />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">
                {t("admin.comms.field.level")}
              </span>
              <select
                value={level}
                data-testid="admin-announcement-level"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                onChange={(event) =>
                  setLevel(event.target.value as typeof level)
                }
              >
                <option value="info">{t("admin.comms.level.info")}</option>
                <option value="warning">
                  {t("admin.comms.level.warning")}
                </option>
                <option value="danger">{t("admin.comms.level.danger")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">
                {t("admin.comms.field.audience")}
              </span>
              <select
                value={audience}
                data-testid="admin-announcement-audience"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                onChange={(event) =>
                  setAudience(event.target.value as "all" | "segment")
                }
              >
                <option value="all">{t("admin.comms.audience.all")}</option>
                <option value="segment">
                  {t("admin.comms.audience.segment")}
                </option>
              </select>
            </label>
            {audience === "segment" ? (
              <RecipientPicker
                recipients={recipients}
                onChange={setRecipients}
              />
            ) : null}
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={sendEmail}
                onCheckedChange={setSendEmail}
                aria-label={t("admin.comms.field.sendEmail")}
                data-testid="admin-announcement-sendemail"
              />
              <span className="text-muted-foreground">
                {t("admin.comms.field.sendEmail")}
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCreating(false);
                resetForm();
              }}
            >
              {t("admin.common.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={busy || title.trim() === "" || body.trim() === ""}
              data-testid="admin-announcement-submit"
              onClick={() => void create()}
            >
              {t("admin.announcements.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Recipient picker: an autocomplete over the user directory (TASK-62). The
 * operator types a name/email, picks a match and it becomes a removable chip,
 * so nobody has to remember an address.
 */
function RecipientPicker({
  recipients,
  onChange,
}: {
  recipients: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useAdminT();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<AdminUserRowDto[]>([]);

  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) {
      setMatches([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      adminApi
        .listUsers({ search: value, limit: 6 })
        .then((page) => {
          if (active) setMatches(page.items);
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const add = (email: string) => {
    if (!recipients.includes(email)) onChange([...recipients, email]);
    setQuery("");
    setMatches([]);
  };

  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">
        {t("admin.comms.field.recipients")}
      </span>
      {recipients.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {recipients.map((email) => (
            <button
              key={email}
              type="button"
              className="inline-flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[11px]"
              onClick={() =>
                onChange(recipients.filter((entry) => entry !== email))
              }
            >
              {email} ✕
            </button>
          ))}
        </div>
      ) : null}
      <Input
        value={query}
        placeholder={t("admin.comms.recipients.placeholder")}
        data-testid="admin-announcement-recipients"
        onChange={(event) => setQuery(event.target.value)}
      />
      {matches.length > 0 ? (
        <div className="rounded-md border border-border bg-card">
          {matches.map((user) => (
            <button
              key={user.id}
              type="button"
              className="block w-full px-2 py-1 text-left text-xs hover:bg-hover"
              onClick={() => add(user.email)}
            >
              {user.displayName ? `${user.displayName} · ` : ""}
              {user.email}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
