import { useEffect, useState } from "react";
import type { AdminMasterRowDto } from "@janosik/shared";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/Toast";
import { adminApi } from "./admin-client";
import { useAdminT } from "./admin-i18n";
import { CharCount } from "./ui";

export function MasterAllowlistDialog({
  master,
  open,
  onClose,
}: {
  master: AdminMasterRowDto | null;
  open: boolean;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        {master ? (
          <MasterAllowlistForm
            key={master.id}
            master={master}
            onClose={onClose}
            onBusyChange={setBusy}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MasterAllowlistForm({
  master,
  onClose,
  onBusyChange,
}: {
  master: AdminMasterRowDto;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useAdminT();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    adminApi
      .getMasterAllowlist(master.id)
      .then((result) => {
        if (active) {
          setValue(result.ipAllowlist ?? "");
          setPhase("ready");
        }
      })
      .catch(() => {
        if (active) setPhase("error");
      });
    return () => {
      active = false;
    };
  }, [master.id]);

  const save = async () => {
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      await adminApi.updateMasterAllowlist(master.id, {
        ipAllowlist: value.trim() || null,
      });
      toast.success(t("admin.masters.allowlist.saved"));
      onClose();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 400
          ? t(
              cause.messageText.startsWith("The allowlist must include")
                ? "admin.masters.allowlist.selfLock"
                : "admin.masters.allowlist.invalid",
            )
          : t("admin.common.actionFailed"),
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t("admin.masters.allowlist.title", { email: master.email })}
        </DialogTitle>
        <DialogDescription>
          {t("admin.masters.allowlist.hint")}
        </DialogDescription>
      </DialogHeader>
      {phase === "error" ? (
        <p role="alert" className="text-xs text-danger">
          {t("admin.masters.allowlist.loadError")}
        </p>
      ) : (
        <div>
          <Input
            aria-label={t("admin.masters.action.allowlist")}
            value={value}
            maxLength={500}
            placeholder="203.0.113.7, 10.0.0.0/8"
            disabled={phase !== "ready" || busy}
            onChange={(event) => setValue(event.target.value)}
          />
          <div className="flex justify-end">
            <CharCount value={value} max={500} />
          </div>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={onClose}
        >
          {t("admin.common.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={phase !== "ready" || busy}
          onClick={() => void save()}
        >
          {t("admin.common.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
