import { useSearchParams } from "react-router-dom";

import { CommsPage } from "../CommsPage";
import { EntityPage } from "../EntityPage";
import { useEntityConfig } from "../entity-configs";
import { SharesPage } from "../SharesPage";
import { HubFrame } from "./HubTabs";

function AnnouncementHistory() {
  const config = useEntityConfig("announcements");
  return <EntityPage key="announcements" config={config} />;
}

/**
 * Communications hub: composer + templates, the announcement history and the
 * public share inventory now share one context instead of three nav entries.
 */
export function CommunicationsHubPage() {
  const [params] = useSearchParams();
  const tab = params.get("tab") ?? "announcements";

  return (
    <HubFrame hub="communications" bodyClassName="min-h-0 flex-1">
      {tab === "history" ? (
        <AnnouncementHistory />
      ) : tab === "shares" ? (
        <div className="h-full overflow-y-auto">
          <SharesPage />
        </div>
      ) : (
        <div className="h-full overflow-y-auto">
          <CommsPage />
        </div>
      )}
    </HubFrame>
  );
}
