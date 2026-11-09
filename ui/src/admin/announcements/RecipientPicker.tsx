import { useEffect, useState } from "react";
import type { AdminUserRowDto } from "@janosik/shared";
import { Input } from "@/components/ui/input";
import { adminApi } from "../admin-client";
import { useAdminT } from "../admin-i18n";

/**
 * Recipient picker: an autocomplete over the user directory (TASK-62). The
 * operator types a name/email, picks a match and it becomes a removable chip,
 * so nobody has to remember an address.
 */
export function RecipientPicker({
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
    if (value.length < 2) return;
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

  const visibleMatches = query.trim().length >= 2 ? matches : [];

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
        maxLength={200}
        placeholder={t("admin.comms.recipients.placeholder")}
        data-testid="admin-announcement-recipients"
        onChange={(event) => setQuery(event.target.value)}
      />
      {visibleMatches.length > 0 ? (
        <div className="rounded-md border border-border bg-card">
          {visibleMatches.map((user) => (
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
