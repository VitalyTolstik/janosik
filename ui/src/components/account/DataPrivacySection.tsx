import { useEffect, useRef, useState, type FormEvent } from "react";
import { Database, Download, ShieldAlert, Trash2 } from "lucide-react";

import { api, ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/auth/AuthContext";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/i18n";
import { downloadBlob } from "@/utils/download";
import type { UserDataExportDto } from "@janosik/shared";

/**
 * TASK-166 self-service data rights (ADR §12.5): request a personal JSON
 * bundle, download it while the seven-day link lives, and schedule account
 * deletion. The delete proof is the password for a password account, or a
 * fresh OAuth token plus a one-time email code for an OAuth-only account.
 */
export function DataPrivacySection() {
  const { t } = useI18n();
  const toast = useToast();
  const { user, logout } = useAuth();
  const [exportRow, setExportRow] = useState<UserDataExportDto | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exportKey = user ? `janosik:account-export:${user.id}` : null;
  // Bumped whenever a newer export starts; a slow initial lookup must not
  // replace the row the user just requested.
  const exportEpoch = useRef(0);

  useEffect(() => {
    if (!exportKey) return;
    let alive = true;
    const epoch = ++exportEpoch.current;
    let id: string | null = null;
    try {
      id = localStorage.getItem(exportKey);
    } catch {
      /* unavailable storage */
    }
    const lookup = id
      ? api.accountExportStatus(id).catch(() => api.latestAccountExport())
      : api.latestAccountExport();
    void lookup
      .then((row) => {
        if (alive && epoch === exportEpoch.current && row) {
          setExportRow(row);
          try {
            localStorage.setItem(exportKey, row.id);
          } catch {
            /* unavailable storage */
          }
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [exportKey]);

  const deletionMethod =
    user?.deletionMethod ??
    (user?.hasPassword === false ? "email_code" : "password");
  const emailCodeFlow = deletionMethod === "email_code";
  const emailMatches =
    user !== null &&
    confirmEmail.trim().toLowerCase() === user.email.trim().toLowerCase();
  const proofReady = emailCodeFlow
    ? codeSent && emailCode.trim().length > 0
    : password.length > 0;
  const canDelete = emailMatches && proofReady && !deleting;

  /** A fresh access token is the OAuth proof; refresh before every proof use. */
  const freshAccessToken = async (): Promise<string | undefined> => {
    try {
      await api.refreshSession();
    } catch {
      /* fall back to the current token; the server still validates it */
    }
    return api.getAccessToken() ?? undefined;
  };

  // A queued export may need a few seconds to build; poll while it is
  // pending and stop on ready/failed (or unmount).
  useEffect(() => {
    if (exportRow?.status !== "pending") return;
    let alive = true;
    const timer = setInterval(() => {
      void api
        .accountExportStatus(exportRow.id)
        .then((row) => {
          if (alive) setExportRow(row);
        })
        .catch(() => undefined);
    }, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [exportRow]);

  const requestExport = async () => {
    const epoch = ++exportEpoch.current;
    setExporting(true);
    setError(null);
    try {
      const row = await api.requestAccountExport();
      if (epoch !== exportEpoch.current) return;
      if (exportKey) {
        try {
          localStorage.setItem(exportKey, row.id);
        } catch {
          /* unavailable storage */
        }
      }
      setExportRow(row);
      toast.success(t("account.data.exportRequested"));
    } catch (cause) {
      const body =
        cause instanceof ApiError
          ? (cause.body as {
              exportId?: unknown;
              details?: { exportId?: unknown };
            } | null)
          : null;
      const found = body?.exportId ?? body?.details?.exportId;
      const id =
        cause instanceof ApiError &&
        cause.status === 409 &&
        typeof found === "string"
          ? found
          : null;
      if (id) {
        try {
          const row = await api.accountExportStatus(id);
          if (epoch !== exportEpoch.current) return;
          if (exportKey) {
            try {
              localStorage.setItem(exportKey, id);
            } catch {
              /* unavailable storage */
            }
          }
          setExportRow(row);
        } catch {
          setError(exportError(cause, t));
        }
      } else setError(exportError(cause, t));
    } finally {
      setExporting(false);
    }
  };

  const downloadExport = async () => {
    if (!exportRow) return;
    try {
      const blob = await api.downloadAccountExport(exportRow.id);
      downloadBlob(`janosik-account-${exportRow.id}.json`, blob);
    } catch {
      setError(t("account.data.downloadFailed"));
    }
  };

  const requestCode = async () => {
    setSendingCode(true);
    setError(null);
    try {
      await api.requestAccountDeletionCode({
        oauthProof: await freshAccessToken(),
      });
      setCodeSent(true);
      toast.success(t("account.data.codeSent"));
    } catch (cause) {
      setError(requestCodeError(cause, t));
    } finally {
      setSendingCode(false);
    }
  };

  const deleteAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!canDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteAccount({
        confirmEmail: confirmEmail.trim(),
        ...(emailCodeFlow
          ? {
              oauthProof: await freshAccessToken(),
              emailCode: emailCode.trim(),
            }
          : { password }),
      });
      toast.success(t("account.data.deleteScheduled"));
      await logout();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 401
          ? emailCodeFlow
            ? t("account.data.oauthProofFailed")
            : t("account.data.wrongPassword")
          : cause instanceof ApiError && cause.status === 429
            ? t("account.data.rateLimited")
            : t("account.data.genericError"),
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="space-y-5" data-testid="account-data">
      <header className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Database className="h-4 w-4 text-primary" aria-hidden />
          {t("account.data.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("account.data.description")}
        </p>
      </header>

      <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
        <h4 className="text-xs font-medium text-muted-foreground">
          {t("account.data.exportTitle")}
        </h4>
        <p className="text-xs text-muted-foreground">
          {t("account.data.exportHint")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            data-testid="account-export-request"
            disabled={exporting}
            onClick={() => void requestExport()}
          >
            <Download className="h-4 w-4" aria-hidden />
            {exportRow
              ? t("account.data.exportAgain")
              : t("account.data.exportRequest")}
          </Button>
          {exportRow?.status === "ready" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="account-export-download"
              onClick={() => void downloadExport()}
            >
              {t("account.data.download")}
            </Button>
          ) : null}
          <span
            className="text-xs text-muted-foreground"
            data-testid="account-export-status"
          >
            {exportRow === null
              ? t("account.data.status.none")
              : exportRow.status === "pending"
                ? t("account.data.status.pending")
                : exportRow.status === "ready"
                  ? t("account.data.status.ready")
                  : t("account.data.status.failed")}
          </span>
        </div>
      </div>

      <form
        noValidate
        onSubmit={deleteAccount}
        className="space-y-3 rounded-lg border border-danger/30 bg-danger/5 p-4"
      >
        <h4 className="flex items-center gap-2 text-xs font-medium text-danger">
          <ShieldAlert className="h-4 w-4" aria-hidden />
          {t("account.data.deleteTitle")}
        </h4>
        <p className="text-xs text-muted-foreground">
          {t("account.data.deleteHint")}
        </p>
        <div className="space-y-1.5">
          <label
            htmlFor="account-delete-email"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("account.data.confirmEmail")}
          </label>
          <Input
            id="account-delete-email"
            data-testid="account-delete-email"
            type="email"
            value={confirmEmail}
            autoComplete="off"
            maxLength={320}
            onChange={(event) => setConfirmEmail(event.target.value)}
          />
        </div>
        {emailCodeFlow ? (
          <div className="space-y-1.5">
            <label
              htmlFor="account-delete-code"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("account.data.emailCode")}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="account-delete-code"
                data-testid="account-delete-code"
                value={emailCode}
                inputMode="numeric"
                maxLength={8}
                className="max-w-40"
                onChange={(event) => setEmailCode(event.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="account-delete-request-code"
                disabled={sendingCode || confirmEmail.length === 0}
                onClick={() => void requestCode()}
              >
                {t("account.data.sendCode")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <label
              htmlFor="account-delete-password"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("account.data.password")}
            </label>
            <Input
              id="account-delete-password"
              data-testid="account-delete-password"
              type="password"
              value={password}
              autoComplete="current-password"
              maxLength={256}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        )}
        {error ? (
          <p
            role="alert"
            data-testid="account-data-error"
            className="text-xs text-danger"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="destructive"
            size="sm"
            data-testid="account-delete-submit"
            disabled={!canDelete}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            {deleting
              ? t("account.data.deleting")
              : t("account.data.deleteSubmit")}
          </Button>
        </div>
      </form>
    </section>
  );
}

function requestCodeError(
  cause: unknown,
  t: (key: MessageKey) => string,
): string {
  if (!(cause instanceof ApiError)) return t("account.data.genericError");
  if (cause.status === 429) return t("account.data.rateLimited");
  if (cause.status === 401) return t("account.data.oauthProofFailed");
  const body = cause.body as { message?: unknown } | null;
  return typeof body?.message === "string"
    ? body.message
    : t("account.data.genericError");
}

function exportError(cause: unknown, t: (key: MessageKey) => string): string {
  if (!(cause instanceof ApiError)) return t("account.data.genericError");
  if (cause.code === "export_in_progress") {
    return t("account.data.exportInProgress");
  }
  if (cause.code === "payload_too_large") {
    return t("account.data.exportTooLarge");
  }
  if (cause.status === 429) return t("account.data.rateLimited");
  const body = cause.body as { message?: unknown } | null;
  return typeof body?.message === "string"
    ? body.message
    : t("account.data.genericError");
}
