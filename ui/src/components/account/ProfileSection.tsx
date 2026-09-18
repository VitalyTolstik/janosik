import { useState, type FormEvent } from "react";
import { Check, RotateCcw } from "lucide-react";
import { DISPLAY_NAME_MAX, type UserAvatarColor } from "@janosik/shared";

import { api } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/Toast";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  AVATAR_COLOR_KEYS,
  avatarColorClass,
  avatarColorKey,
  userInitials,
} from "@/utils/avatar";

/**
 * Profile section (TASK-36.1): the avatar preview and palette picker, the
 * editable display name and the read-only email. Email changes need a
 * verification flow the project does not have yet, so the field is locked
 * with a hint instead of pretending it is editable.
 */
export function ProfileSection() {
  const { user, updateUser } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState(user?.displayName ?? "");
  const [color, setColor] = useState<UserAvatarColor | null>(
    user?.avatarColor ?? null,
  );
  const [saving, setSaving] = useState(false);

  if (user === null) return null;

  const trimmed = name.trim();
  const dirty =
    trimmed !== (user.displayName ?? "") || color !== user.avatarColor;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const next = await api.updateProfile({
        displayName: trimmed === "" ? null : trimmed,
        avatarColor: color,
      });
      updateUser(next);
      setName(next.displayName ?? "");
      toast.success(t("account.profile.saved"));
    } catch {
      toast.error(t("account.profile.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5" data-testid="account-profile">
      <header className="space-y-1">
        <h3 className="text-sm font-semibold">{t("account.profile.title")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("account.profile.description")}
        </p>
      </header>

      <div className="flex flex-col gap-5 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center">
        <span
          aria-hidden
          className={cn(
            "flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-semibold text-white shadow-sm",
            avatarColorClass(color ?? avatarColorKey(user.id)),
          )}
        >
          {userInitials(name, user.email)}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("account.profile.colorLabel")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="avatar-color-auto"
              aria-label={t("account.profile.colorAuto")}
              aria-pressed={color === null}
              title={t("account.profile.colorAuto")}
              onClick={() => setColor(null)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-foreground/40 text-foreground/70 transition-transform hover:scale-110",
                color === null &&
                  "ring-2 ring-ring ring-offset-2 ring-offset-background",
              )}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            </button>
            {AVATAR_COLOR_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                data-testid={`avatar-color-${key}`}
                aria-label={t("account.profile.color", { color: key })}
                aria-pressed={color === key}
                onClick={() => setColor(key)}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-white transition-transform hover:scale-110",
                  avatarColorClass(key),
                  color === key &&
                    "ring-2 ring-ring ring-offset-2 ring-offset-background",
                )}
              >
                {color === key ? (
                  <Check className="h-3.5 w-3.5" aria-hidden />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="account-display-name"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("account.profile.nameLabel")}
          </label>
          <div className="flex gap-2">
            <Input
              id="account-display-name"
              data-testid="account-display-name"
              value={name}
              maxLength={DISPLAY_NAME_MAX}
              placeholder={t("account.profile.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
            <Button
              type="submit"
              data-testid="account-profile-save"
              disabled={!dirty || saving}
            >
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("account.profile.nameHint", { max: DISPLAY_NAME_MAX })}
          </p>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="account-email"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("account.profile.emailLabel")}
          </label>
          <Input
            id="account-email"
            data-testid="account-email"
            value={user.email}
            disabled
            readOnly
          />
          <p className="text-[11px] text-muted-foreground">
            {t("account.profile.emailHint")}
          </p>
        </div>
      </form>
    </section>
  );
}
