import { useSearchParams } from "react-router-dom";
import type { AdminEntity } from "@janosik/shared";

import { EntityPage } from "../EntityPage";
import { useEntityConfig } from "../entity-configs";
import { HubFrame } from "./HubTabs";

const ENTITY_BY_TAB: Record<string, AdminEntity> = {
  boards: "boards",
  cards: "cards",
  columns: "columns",
  labels: "labels",
  checklists: "checklists",
  links: "cardLinks",
};

function EntityTab({ entity }: { entity: AdminEntity }) {
  const config = useEntityConfig(entity);
  return <EntityPage key={entity} config={config} />;
}

/** Boards hub: boards + every content data-browser that used to be a nav item. */
export function BoardsHubPage() {
  const [params] = useSearchParams();
  const tab = params.get("tab") ?? "boards";
  const entity = ENTITY_BY_TAB[tab] ?? "boards";
  return (
    <HubFrame hub="boards" bodyClassName="min-h-0 flex-1">
      <EntityTab entity={entity} />
    </HubFrame>
  );
}
