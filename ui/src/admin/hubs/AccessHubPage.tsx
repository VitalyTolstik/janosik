import { useSearchParams } from "react-router-dom";
import type { AdminEntity } from "@janosik/shared";

import { EntityPage } from "../EntityPage";
import { useEntityConfig } from "../entity-configs";
import { MastersPage } from "../MastersPage";
import { HubFrame } from "./HubTabs";

const ENTITY_BY_TAB: Record<string, AdminEntity> = {
  sessions: "sessions",
  tokens: "tokens",
};

function AccessTab({ entity }: { entity: AdminEntity }) {
  const config = useEntityConfig(entity);
  return <EntityPage key={entity} config={config} />;
}

/**
 * Access & security hub: sessions, API tokens and (owner only) masters.
 * Masters is hidden from an operator's tabs but a direct URL still mounts the
 * page, whose server call returns 403 and becomes an explicit forbidden state.
 */
export function AccessHubPage() {
  const [params] = useSearchParams();
  const tab = params.get("tab") ?? "sessions";
  return (
    <HubFrame hub="access" bodyClassName="min-h-0 flex-1">
      {tab === "masters" ? (
        <div className="h-full overflow-y-auto">
          <MastersPage />
        </div>
      ) : (
        <AccessTab entity={ENTITY_BY_TAB[tab] ?? "sessions"} />
      )}
    </HubFrame>
  );
}
