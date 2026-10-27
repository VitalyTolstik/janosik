import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, ChevronDown, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import {
  API_TOKEN_NAME_MAX,
  type CreateUserTokenResponse,
  type UserTokenDto,
} from "@janosik/shared";

import { api } from "@/api/client";
import { ConfirmDialog } from "@/components/board/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/Toast";
import { formatDateOnly, useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/i18n";
import { cn } from "@/lib/utils";

type ExpiryPreset = "never" | "30" | "90" | "365";

const EXPIRY_PRESETS: { id: ExpiryPreset; labelKey: MessageKey }[] = [
  { id: "never", labelKey: "account.tokens.expiryNever" },
  { id: "30", labelKey: "account.tokens.expiry30" },
  { id: "90", labelKey: "account.tokens.expiry90" },
  { id: "365", labelKey: "account.tokens.expiry365" },
];

/**
 * The `expiresAt` to send. "Never" is an explicit `null`: the server gives a
 * token created *without* the field a 90-day default.
 */
function expiryIso(preset: ExpiryPreset): string | null {
  if (preset === "never") return null;
  const days = Number(preset);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Personal API tokens (TASK-36.1). A token is a real credential: `jnk_…`
 * authenticates the REST API exactly like a session, so the section follows
 * the security-by-design rules — the plaintext is shown once and never
 * listed, only a sha256 lives in the database, and revocation is immediate.
 */
export function ApiTokensSection() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [tokens, setTokens] = useState<UserTokenDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<ExpiryPreset>("never");
  const [creating, setCreating] = useState(false);
  const [reveal, setReveal] = useState<CreateUserTokenResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<UserTokenDto | null>(null);

  const load = useCallback(async () => {
    try {
      setTokens(await api.listTokens());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === "" || creating) return;
    setCreating(true);
    try {
      const created = await api.createToken({
        name: name.trim(),
        expiresAt: expiryIso(preset),
      });
      setReveal(created);
      void load();
    } catch {
      toast.error(t("account.tokens.createError"));
    } finally {
      setCreating(false);
    }
  };

  const closeCreate = (open: boolean) => {
    setCreateOpen(open);
    if (!open) {
      setReveal(null);
      setCopied(false);
      setName("");
      setPreset("never");
    }
  };

  const copyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
    } catch {
      copyFallback(token);
    }
    setCopied(true);
    toast.success(t("account.tokens.copied"));
  };

  const revoke = async () => {
    if (revokeTarget === null) return;
    try {
      await api.revokeToken(revokeTarget.id);
      toast.success(t("account.tokens.revokedToast"));
      void load();
    } catch {
      toast.error(t("account.tokens.revokeError"));
    }
  };

  return (
    <section className="space-y-5" data-testid="account-tokens">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-primary" aria-hidden />
            {t("account.tokens.title")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("account.tokens.description")}
          </p>
        </div>
        <Button
          size="sm"
          data-testid="token-create"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t("account.tokens.create")}
        </Button>
      </header>

      {loadError ? (
        <p className="text-xs text-danger">{t("account.tokens.loadError")}</p>
      ) : null}

      {tokens !== null && tokens.length === 0 && !loadError ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center">
          <KeyRound className="h-6 w-6 text-muted-foreground/60" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {t("account.tokens.empty")}
          </p>
        </div>
      ) : null}

      {tokens !== null && tokens.length > 0 ? (
        <ul className="divide-y rounded-lg border" data-testid="token-list">
          {tokens.map((token) => (
            <TokenRow
              key={token.id}
              token={token}
              lang={lang}
              onRevoke={() => setRevokeTarget(token)}
            />
          ))}
        </ul>
      ) : null}

      <Dialog open={createOpen} onOpenChange={closeCreate}>
        <DialogContent className="sm:max-w-md" data-testid="token-dialog">
          {reveal === null ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{t("account.tokens.createTitle")}</DialogTitle>
                <DialogDescription>
                  {t("account.tokens.createDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <label
                  htmlFor="token-name"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t("account.tokens.nameLabel")}
                </label>
                <Input
                  id="token-name"
                  data-testid="token-name"
                  value={name}
                  maxLength={API_TOKEN_NAME_MAX}
                  placeholder={t("account.tokens.namePlaceholder")}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("account.tokens.expiryLabel")}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="token-expiry"
                      className="w-full justify-between font-normal"
                    >
                      {t(
                        EXPIRY_PRESETS.find((item) => item.id === preset)!
                          .labelKey,
                      )}
                      <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuRadioGroup
                      value={preset}
                      onValueChange={(value) =>
                        setPreset(value as ExpiryPreset)
                      }
                    >
                      {EXPIRY_PRESETS.map((item) => (
                        <DropdownMenuRadioItem key={item.id} value={item.id}>
                          {t(item.labelKey)}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => closeCreate(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  data-testid="token-create-submit"
                  disabled={name.trim() === "" || creating}
                >
                  {creating ? t("common.creating") : t("account.tokens.create")}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>{t("account.tokens.revealTitle")}</DialogTitle>
                <DialogDescription>
                  {t("account.tokens.revealWarning")}
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
                <code
                  data-testid="token-reveal"
                  className="min-w-0 flex-1 break-all font-mono text-xs text-foreground"
                >
                  {reveal.token}
                </code>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  data-testid="token-copy"
                  aria-label={t("account.tokens.copy")}
                  onClick={() => void copyToken(reveal.token)}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-success" aria-hidden />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden />
                  )}
                </Button>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  data-testid="token-done"
                  onClick={() => closeCreate(false)}
                >
                  {t("account.tokens.done")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revokeTarget !== null}
        title={t("account.tokens.revokeConfirmTitle")}
        description={t("account.tokens.revokeConfirmDescription", {
          name: revokeTarget?.name ?? "",
        })}
        confirmLabel={t("account.tokens.revoke")}
        destructive
        onConfirm={() => void revoke()}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      />
    </section>
  );
}

function TokenRow({
  token,
  lang,
  onRevoke,
}: {
  token: UserTokenDto;
  lang: Parameters<typeof formatDateOnly>[1];
  onRevoke: () => void;
}) {
  const { t } = useI18n();
  const expired =
    token.expiresAt !== null &&
    token.expiresAt <= Date.now() &&
    !token.revokedAt;
  const status: { label: string; className: string } =
    token.revokedAt !== null
      ? {
          label: t("account.tokens.revoked"),
          className: "text-muted-foreground",
        }
      : expired
        ? {
            label: t("account.tokens.expired"),
            className: "text-warning",
          }
        : {
            label: t("account.tokens.active"),
            className: "text-success",
          };

  return (
    <li
      data-testid="token-row"
      data-token-id={token.id}
      className="flex items-center gap-3 px-4 py-3"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex items-center gap-2 truncate text-sm font-medium">
          {token.name}
          <span
            className={cn(
              "shrink-0 text-[10px] font-medium uppercase tracking-wide",
              status.className,
            )}
          >
            {status.label}
          </span>
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {t("account.tokens.meta", {
            created: formatDateOnly(token.createdAt, lang),
            used:
              token.lastUsedAt === null
                ? t("account.tokens.neverUsed")
                : formatDateOnly(token.lastUsedAt, lang),
          })}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {token.expiresAt === null
            ? t("account.tokens.noExpiry")
            : t("account.tokens.expiresOn", {
                date: formatDateOnly(token.expiresAt, lang),
              })}
        </p>
      </div>
      {token.revokedAt === null ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid="token-revoke"
          className="text-danger hover:bg-danger/10 hover:text-danger"
          onClick={onRevoke}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{t("account.tokens.revoke")}</span>
        </Button>
      ) : null}
    </li>
  );
}

/** Clipboard fallback for browsers/contexts without the async API. */
function copyFallback(text: string): void {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
  } catch {
    /* no clipboard at all — the reveal box still lets the user copy manually */
  }
}
