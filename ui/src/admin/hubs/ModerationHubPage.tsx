import { useSearchParams } from "react-router-dom";
import type { AdminEntity } from "@janosik/shared";

import { EntityPage } from "../EntityPage";
import { useEntityConfig } from "../entity-configs";
import { HubFrame } from "./HubTabs";

const ENTITY_BY_TAB: Record<string, AdminEntity> = {
  comments: "comments",
  attachments: "attachments",
};

function ModerationTab({ entity }: { entity: AdminEntity }) {
  const config = useEntityConfig(entity);
  return <EntityPage key={entity} config={config} />;
}

/** Moderation hub: comments and attachments stay one queue, two tabs. */
export function ModerationHubPage() {
  const [params] = useSearchParams();
  const tab = params.get("tab") ?? "comments";
  const entity = ENTITY_BY_TAB[tab] ?? "comments";
  return (
    <HubFrame hub="moderation" bodyClassName="min-h-0 flex-1">
      <ModerationTab entity={entity} />
    </HubFrame>
  );
}
