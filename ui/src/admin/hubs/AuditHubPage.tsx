import { useSearchParams } from "react-router-dom";
import type { AdminEntity } from "@janosik/shared";

import { EntityPage } from "../EntityPage";
import { useEntityConfig } from "../entity-configs";
import { HubFrame } from "./HubTabs";

const ENTITY_BY_TAB: Record<string, AdminEntity> = {
  audit: "audit",
  commands: "commands",
  activity: "activity",
};

function AuditTab({ entity }: { entity: AdminEntity }) {
  const config = useEntityConfig(entity);
  return <EntityPage key={entity} config={config} />;
}

/** Audit & activity hub: the audit trail, command log and activity feed. */
export function AuditHubPage() {
  const [params] = useSearchParams();
  const tab = params.get("tab") ?? "audit";
  const entity = ENTITY_BY_TAB[tab] ?? "audit";
  return (
    <HubFrame hub="audit" bodyClassName="min-h-0 flex-1">
      <AuditTab entity={entity} />
    </HubFrame>
  );
}
