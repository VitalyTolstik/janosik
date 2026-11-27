import { useEffect, useState } from "react";

import { api, isApiEnabled } from "@/api/client";

/**
 * Whether the server allows public share links (M4).
 *
 * `ALLOW_PUBLIC_SHARES=false` must hide the entry point, not only make the
 * minted token 404. `null` = config not read yet, so the trigger does not
 * flash before the answer; a failed read keeps the control visible (the
 * server still refuses creation independently).
 */
export function usePublicSharesEnabled(): boolean | null {
  const [publicSharesEnabled, setPublicSharesEnabled] = useState<
    boolean | null
  >(() => (isApiEnabled() ? null : true));

  useEffect(() => {
    if (!isApiEnabled()) return;
    let alive = true;
    void api
      .authConfig()
      .then((config) => {
        if (alive) setPublicSharesEnabled(config.allowPublicShares);
      })
      .catch(() => {
        if (alive) setPublicSharesEnabled(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return publicSharesEnabled;
}
