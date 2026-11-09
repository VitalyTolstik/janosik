import { useEffect, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";

import { Notice } from "@/components/notifications/Notice";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { UPDATE_EVENT, applyServiceWorkerUpdate } from "@/pwa/register-sw";

/**
 * "A new version is ready" notice (TASK-151, C5). The service worker waits
 * instead of seizing open tabs; the user decides when to apply it.
 *
 * `inline` renders inside the authenticated notice stack. `floating` is the
 * compact fallback for login, verification, admin and public share screens,
 * where no stack exists — the two variants are never mounted together.
 */
export function UpdatePrompt({
  variant = "floating",
}: {
  variant?: "inline" | "floating";
}) {
  const { t } = useI18n();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const onUpdate = () => setAvailable(true);
    window.addEventListener(UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(UPDATE_EVENT, onUpdate);
  }, []);

  if (!available) return null;

  const notice = (
    <Notice
      tone="brand"
      icon={Sparkles}
      eyebrow={variant === "inline" ? t("app.updateEyebrow") : undefined}
      title={t("app.updateAvailable")}
      body={variant === "inline" ? t("app.updateBody") : undefined}
      testId="update-prompt"
      actions={
        <Button size="sm" onClick={applyServiceWorkerUpdate}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          {t("app.updateReload")}
        </Button>
      }
      close={{
        onClick: () => setAvailable(false),
        label: t("common.dismissNotification"),
      }}
    />
  );

  if (variant === "inline") return notice;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-[520px]">{notice}</div>
    </div>
  );
}
