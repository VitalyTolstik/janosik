import { useState, type FormEvent } from "react";
import { Check, ChevronDown, KeyRound, Loader2 } from "lucide-react";
import {
  API_TOKEN_NAME_MAX,
  API_TOKEN_RATE_MAX,
  API_TOKEN_RATE_MIN,
  SCOPE_PRESETS,
  type BoardSummary,
  type ScopePreset,
  type UserTokenDto,
} from "@janosik/shared";

import { api, ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
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
import { NumberStepper } from "@/components/ui/number-stepper";
import { SelectField } from "@/components/ui/select-field";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/i18n";

const SCOPE_PRESET_LABELS: Record<ScopePreset, MessageKey> = {
  observer: "account.tokens.presetObserver",
  worker: "account.tokens.presetWorker",
  reviewer: "account.tokens.presetReviewer",
  admin: "account.tokens.presetAdmin",
};

function errorMessage(error: unknown, t: ReturnType<typeof useI18n>["t"]) {
  if (error instanceof ApiError && error.offline) {
    return t("account.tokens.editOffline");
  }
  if (error instanceof ApiError && error.body !== null) {
    const body = error.body as { code?: unknown };
    if (body.code === "pat_forbidden")
      return t("account.tokens.editSessionOnly");
  }
  if (error instanceof ApiError && error.status === 403) {
    return t("account.tokens.editSessionOnly");
  }
  return t("account.tokens.editError");
}

/**
 * Owner edit dialog for one personal API key (TASK-166.15).
 *
 * Scope presets, trusted CI, board scope, read-only and the per-token rate
 * limit are editable from a browser session; the server re-validates every
 * field, audits the before/after values and never returns a secret. The body
 * mounts only while the parent has a target, so closing and reopening starts
 * from the stored token — the project's reset-by-remount rule.
 */
export function TokenEditDialog({
  token,
  boards,
  onClose,
  onSaved,
}: {
  token: UserTokenDto;
  boards: BoardSummary[];
  onClose: () => void;
  onSaved: (token: UserTokenDto) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState(token.name);
  const [boardId, setBoardId] = useState(token.boardId ?? "");
  const [scopePreset, setScopePreset] = useState<ScopePreset>(
    token.scopePreset,
  );
  const [trustedCi, setTrustedCi] = useState(
    token.trustedCi && !token.readOnly && token.scopePreset !== "observer",
  );
  const [readOnly, setReadOnly] = useState(token.readOnly);
  const [rateLimit, setRateLimit] = useState(
    token.rateLimitPerMinute === null ? "" : String(token.rateLimitPerMinute),
  );
  const [rateError, setRateError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trustedCiDisabled = readOnly || scopePreset === "observer";

  const changeScopePreset = (value: ScopePreset) => {
    setScopePreset(value);
    if (value === "observer") setTrustedCi(false);
  };
  const changeReadOnly = (value: boolean) => {
    setReadOnly(value);
    if (value) setTrustedCi(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (name.trim() === "") return;
    const rate = rateLimit.trim() === "" ? null : Number(rateLimit);
    if (
      rate !== null &&
      (!Number.isInteger(rate) ||
        rate < API_TOKEN_RATE_MIN ||
        rate > API_TOKEN_RATE_MAX)
    ) {
      setRateError(true);
      return;
    }
    setRateError(false);
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateToken(token.id, {
        name: name.trim(),
        boardId: boardId === "" ? null : boardId,
        scopePreset,
        trustedCi,
        readOnly,
        rateLimitPerMinute:
          rate !== null && Number.isInteger(rate) ? rate : null,
      });
      toast.success(t("account.tokens.editSavedToast"));
      onSaved(updated);
    } catch (reason) {
      setError(errorMessage(reason, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-md" data-testid="token-edit-dialog">
      <form noValidate onSubmit={submit} className="space-y-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" aria-hidden />
            {t("account.tokens.editTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("account.tokens.editDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <label
            htmlFor="token-edit-name"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("account.tokens.nameLabel")}
          </label>
          <Input
            id="token-edit-name"
            data-testid="token-edit-name"
            value={name}
            maxLength={API_TOKEN_NAME_MAX}
            placeholder={t("account.tokens.namePlaceholder")}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="token-edit-board"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("account.tokens.boardLabel")}
          </label>
          <SelectField
            id="token-edit-board"
            value={boardId}
            ariaLabel={t("account.tokens.boardLabel")}
            testId="token-edit-board"
            options={[
              { value: "", label: t("account.tokens.boardAll") },
              ...boards.map((board) => ({
                value: board.id,
                label: board.title,
              })),
            ]}
            onChange={setBoardId}
          />
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("account.tokens.presetLabel")}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="token-edit-scope-preset"
                className="w-full justify-between font-normal"
              >
                {t(SCOPE_PRESET_LABELS[scopePreset])}
                <ChevronDown
                  className="h-3.5 w-3.5 text-muted-foreground"
                  aria-hidden
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuRadioGroup
                value={scopePreset}
                onValueChange={(value) =>
                  changeScopePreset(value as ScopePreset)
                }
              >
                {SCOPE_PRESETS.map((item) => (
                  <DropdownMenuRadioItem key={item} value={item}>
                    {t(SCOPE_PRESET_LABELS[item])}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <p className="text-[11px] text-muted-foreground">
            {t("account.tokens.presetHint")}
          </p>
        </div>

        <div className="flex items-start gap-2">
          <Checkbox
            id="token-edit-trusted-ci"
            data-testid="token-edit-trusted-ci"
            aria-label={t("account.tokens.trustedCiLabel")}
            checked={trustedCi}
            disabled={trustedCiDisabled}
            onCheckedChange={setTrustedCi}
            className="mt-0.5"
          />
          <div className="space-y-0.5">
            <label
              htmlFor="token-edit-trusted-ci"
              className={
                trustedCiDisabled
                  ? "cursor-not-allowed text-sm text-muted-foreground"
                  : "cursor-pointer text-sm"
              }
            >
              {t("account.tokens.trustedCiLabel")}
            </label>
            <p className="text-[11px] text-muted-foreground">
              {trustedCiDisabled
                ? t("account.tokens.trustedCiUnavailable")
                : t("account.tokens.trustedCiHint")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="token-edit-read-only"
            data-testid="token-edit-read-only"
            aria-label={t("account.tokens.readOnlyLabel")}
            checked={readOnly}
            onCheckedChange={changeReadOnly}
          />
          <label
            htmlFor="token-edit-read-only"
            className="cursor-pointer text-sm"
          >
            {t("account.tokens.readOnlyLabel")}
          </label>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="token-edit-rate"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("account.tokens.rateLabel")}
          </label>
          <NumberStepper
            id="token-edit-rate"
            testId="token-edit-rate"
            value={rateLimit}
            onChange={(value) => {
              setRateLimit(value);
              setRateError(false);
            }}
            min={API_TOKEN_RATE_MIN}
            max={API_TOKEN_RATE_MAX}
            invalid={rateError && rateLimit !== ""}
            placeholder={t("account.tokens.ratePlaceholder")}
            ariaLabel={t("account.tokens.rateLabel")}
            increaseLabel={t("account.tokens.rateIncrease")}
            decreaseLabel={t("account.tokens.rateDecrease")}
          />
          {rateError && rateLimit !== "" ? (
            <p role="alert" className="text-sm text-danger">
              {t("account.tokens.rateInvalid", {
                min: API_TOKEN_RATE_MIN,
                max: API_TOKEN_RATE_MAX,
              })}
            </p>
          ) : null}
        </div>

        <p className="rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground">
          {t("account.tokens.editLimitsHint")}
        </p>

        {error !== null ? (
          <p
            role="alert"
            data-testid="token-edit-error"
            className="rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger"
          >
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            data-testid="token-edit-cancel"
            onClick={onClose}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            data-testid="token-edit-save"
            disabled={saving || name.trim() === ""}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden />
            )}
            {t("account.tokens.editSave")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
