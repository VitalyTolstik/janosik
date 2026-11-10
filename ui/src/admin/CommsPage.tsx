import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Eye } from "lucide-react";
import type { AdminEmailTemplateDto } from "@janosik/shared";
import { Button } from "@/components/ui/button";
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
import { useAdminAuth } from "./AdminAuthContext";
import { useAdminT } from "./admin-i18n";
import { AnnouncementEditorDialog } from "./announcements/AnnouncementEditorDialog";
import { SettingsSkeleton } from "./skeletons";
import { Badge, CharCount, ErrorState, Field, PageHeader, Panel } from "./ui";
import { fieldError } from "./validation";

/** Length caps mirroring the backend DTOs (AdminSendEmailDto / templates). */
const SUBJECT_MAX = 200;
const BODY_HTML_MAX = 20000;

/**
 * Sample values used to render a template preview (TASK-62): the placeholders
 * an operator can use, filled with plausible content so the letter reads like
 * a real one. Unknown placeholders are left intact.
 */
const PREVIEW_SAMPLES: Record<string, string> = {
  code: "482913",
  minutes: "10",
  email: "you@example.com",
  board: "Product board",
  count: "7",
  hours: "24",
  tasks:
    "<li><strong>Fix the mobile layout</strong> (Product board) — due 2026-11-01</li><li><strong>Add a label filter</strong> (Product board) — due 2026-11-02</li>",
};

/** Fill `{{name}}` placeholders with the preview samples. */
function renderPreview(template: string): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(PREVIEW_SAMPLES, name)
      ? PREVIEW_SAMPLES[name]
      : match,
  );
}

/**
 * Communications (TASK-62): compose a broadcast (in-app banner, optional
 * email) to everyone or hand-picked users, send a one-off letter, edit the
 * mail templates. The full announcement history is its own entity page
 * (`/admin/announcements`) — this page just points there.
 */
export function CommsPage() {
  const t = useAdminT();
  const toast = useToast();
  // TASK-79: comms writes (announcements, one-off mail, templates) are
  // owner-only server-side; an operator sees the letters but edits nothing.
  const { admin } = useAdminAuth();
  const isOwner = admin?.role === "OWNER";
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [templates, setTemplates] = useState<AdminEmailTemplateDto[]>([]);

  const [creating, setCreating] = useState(false);

  const [mailTo, setMailTo] = useState("");
  const [mailSubject, setMailSubject] = useState("");
  const [mailBody, setMailBody] = useState("");
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState<
    Record<string, { subject: string; bodyHtml: string }>
  >({});
  const [preview, setPreview] = useState<{
    label: string;
    subject: string;
    html: string;
  } | null>(null);

  const toError = fieldError(t, mailTo, { required: true, email: true });

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

  if (phase === "loading")
    return <SettingsSkeleton testId="admin-comms-skeleton" panels={3} wide />;
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
            disabled={!isOwner}
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
              type="email"
              value={mailTo}
              invalid={mailTo.trim() !== "" && toError !== null}
              data-testid="admin-email-to"
              disabled={!isOwner}
              onChange={(event) => setMailTo(event.target.value)}
            />
            {mailTo.trim() !== "" && toError !== null ? (
              <span role="alert" className="text-[11px] text-danger">
                {toError}
              </span>
            ) : null}
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              {t("admin.comms.email.subject")}
            </span>
            <Input
              value={mailSubject}
              maxLength={SUBJECT_MAX}
              data-testid="admin-email-subject"
              disabled={!isOwner}
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
              disabled={!isOwner}
              onChange={(event) => setMailBody(event.target.value)}
            />
            <CharCount value={mailBody} max={BODY_HTML_MAX} />
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            disabled={
              !isOwner ||
              sending ||
              mailTo.trim() === "" ||
              toError !== null ||
              mailSubject.trim() === "" ||
              mailBody.trim() === ""
            }
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
              <Field
                htmlFor={`admin-template-subject-${template.key}`}
                label={t("admin.comms.templates.subject")}
              >
                <Input
                  id={`admin-template-subject-${template.key}`}
                  data-testid={`admin-template-subject-${template.key}`}
                  aria-label={t("admin.comms.templates.subject")}
                  value={draft[template.key]?.subject ?? ""}
                  maxLength={SUBJECT_MAX}
                  placeholder={t("admin.comms.templates.subject")}
                  disabled={!isOwner}
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
              </Field>
              <CharCount
                value={draft[template.key]?.subject ?? ""}
                max={SUBJECT_MAX}
              />
              <Textarea
                id={`admin-template-body-${template.key}`}
                data-testid={`admin-template-body-${template.key}`}
                aria-label={t("admin.comms.templates.body")}
                value={draft[template.key]?.bodyHtml ?? ""}
                maxLength={BODY_HTML_MAX}
                placeholder={t("admin.comms.templates.body")}
                disabled={!isOwner}
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
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid={`admin-template-preview-${template.key}`}
                  onClick={() =>
                    setPreview({
                      label: template.label,
                      subject: renderPreview(
                        draft[template.key]?.subject ?? "",
                      ),
                      html: renderPreview(draft[template.key]?.bodyHtml ?? ""),
                    })
                  }
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                  {t("admin.comms.templates.preview")}
                </Button>
                {template.custom ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`admin-template-reset-${template.key}`}
                    disabled={!isOwner}
                    onClick={() => void resetTemplate(template.key)}
                  >
                    {t("admin.comms.templates.reset")}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  data-testid={`admin-template-save-${template.key}`}
                  disabled={!isOwner}
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
        open={preview !== null}
        onOpenChange={(next) => (next ? undefined : setPreview(null))}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {t("admin.comms.templates.previewTitle")}
              {preview ? ` — ${preview.label}` : ""}
            </DialogTitle>
          </DialogHeader>
          {preview ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-hover/40 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("admin.comms.templates.subject")}
                </p>
                <p className="text-sm text-foreground">{preview.subject}</p>
              </div>
              <iframe
                title={t("admin.comms.templates.previewTitle")}
                srcDoc={preview.html}
                sandbox=""
                data-testid="admin-template-preview-frame"
                className="h-[60vh] w-full rounded-lg border border-border bg-white"
              />
              <p className="text-[11px] text-muted-foreground">
                {t("admin.comms.templates.previewNote")}
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPreview(null)}
            >
              {t("admin.common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {creating ? (
        <AnnouncementEditorDialog
          onClose={() => setCreating(false)}
          onDone={load}
        />
      ) : null}
    </div>
  );
}
