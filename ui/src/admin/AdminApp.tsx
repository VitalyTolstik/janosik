import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { Loader2 } from "lucide-react";

import { AdminAuthProvider, useAdminAuth } from "./AdminAuthContext";
import { AdminLoginPage } from "./AdminLoginPage";
import { AdminShell } from "./AdminShell";
import { DashboardPage } from "./DashboardPage";
import { EntityPage } from "./EntityPage";
import { useEntityConfig } from "./entity-configs";
import { UserDetailPage } from "./UserDetailPage";
import { CardDetailPage } from "./CardDetailPage";
import { BoardDetailPage } from "./BoardDetailPage";
import { BoardContentPage } from "./BoardContentPage";
import { BoardWorkflowPage } from "./BoardWorkflowPage";
import { BoardsHubPage } from "./hubs/BoardsHubPage";
import { ModerationHubPage } from "./hubs/ModerationHubPage";
import { AuditHubPage } from "./hubs/AuditHubPage";
import { AccessHubPage } from "./hubs/AccessHubPage";
import { CommunicationsHubPage } from "./hubs/CommunicationsHubPage";
import { SettingsHubPage } from "./hubs/SettingsHubPage";

/**
 * Master panel entry (TASK-36), lazy-loaded from `/admin/*`.
 *
 * Isolation is structural: the admin route tree never mounts the user
 * `AuthProvider`/`BoardProvider`, and the panel talks through its own API
 * client with its own token. The two sessions cannot leak into each other.
 *
 * The redesigned IA exposes eight hubs. Every legacy path below redirects to
 * its hub tab and keeps the query string, so old deep links and bookmarks do
 * not break. Detail routes remain their own pages.
 */

function EntityRoute({
  entity,
}: {
  entity: Parameters<typeof useEntityConfig>[0];
}) {
  const config = useEntityConfig(entity);
  return <EntityPage key={entity} config={config} />;
}

/** Detail pages remount per id so state never leaks between entities. */
function UserDetailRoute() {
  const { userId } = useParams();
  return <UserDetailPage key={userId} />;
}

function CardDetailRoute() {
  const { cardId } = useParams();
  return <CardDetailPage key={cardId} />;
}

function BoardDetailRoute() {
  const { boardId } = useParams();
  return <BoardDetailPage key={boardId} />;
}

/**
 * Sends a legacy path to its hub tab while keeping every unrelated query
 * parameter (`?search=…`, `?status=…`) intact.
 */
function LegacyRedirect({ to, tab }: { to: string; tab?: string }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  if (tab !== undefined) params.set("tab", tab);
  const query = params.toString();
  return <Navigate to={query === "" ? to : `${to}?${query}`} replace />;
}

function AdminGate() {
  const { status } = useAdminAuth();

  if (status === "boot") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2
          className="h-5 w-5 animate-spin text-muted-foreground"
          aria-hidden
        />
      </div>
    );
  }
  if (status === "anonymous") {
    return <AdminLoginPage />;
  }
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<DashboardPage />} />

        <Route path="users" element={<EntityRoute entity="users" />} />
        <Route path="users/:userId" element={<UserDetailRoute />} />

        <Route path="boards" element={<BoardsHubPage />} />
        <Route path="boards/:boardId" element={<BoardDetailRoute />} />
        <Route path="boards/:boardId/content" element={<BoardContentPage />} />
        <Route
          path="boards/:boardId/workflow"
          element={<BoardWorkflowPage />}
        />
        <Route path="cards/:cardId" element={<CardDetailRoute />} />

        <Route path="moderation" element={<ModerationHubPage />} />
        <Route path="audit" element={<AuditHubPage />} />
        <Route path="communications" element={<CommunicationsHubPage />} />
        <Route path="access" element={<AccessHubPage />} />
        <Route path="settings" element={<SettingsHubPage />} />

        {/* Legacy content browsers → Boards hub tabs. */}
        <Route
          path="cards"
          element={<LegacyRedirect to="/admin/boards" tab="cards" />}
        />
        <Route
          path="columns"
          element={<LegacyRedirect to="/admin/boards" tab="columns" />}
        />
        <Route
          path="labels"
          element={<LegacyRedirect to="/admin/boards" tab="labels" />}
        />
        <Route
          path="checklists"
          element={<LegacyRedirect to="/admin/boards" tab="checklists" />}
        />
        <Route
          path="cardLinks"
          element={<LegacyRedirect to="/admin/boards" tab="links" />}
        />

        {/* Legacy moderation pages. */}
        <Route
          path="comments"
          element={<LegacyRedirect to="/admin/moderation" tab="comments" />}
        />
        <Route
          path="attachments"
          element={<LegacyRedirect to="/admin/moderation" tab="attachments" />}
        />

        {/* Legacy audit pages. */}
        <Route
          path="activity"
          element={<LegacyRedirect to="/admin/audit" tab="activity" />}
        />
        <Route
          path="commands"
          element={<LegacyRedirect to="/admin/audit" tab="commands" />}
        />
        <Route
          path="log"
          element={<LegacyRedirect to="/admin/audit" tab="commands" />}
        />

        {/* Legacy access pages. */}
        <Route
          path="sessions"
          element={<LegacyRedirect to="/admin/access" tab="sessions" />}
        />
        <Route
          path="tokens"
          element={<LegacyRedirect to="/admin/access" tab="tokens" />}
        />
        <Route
          path="masters"
          element={<LegacyRedirect to="/admin/access" tab="masters" />}
        />

        {/* Legacy communications pages. */}
        <Route
          path="comms"
          element={
            <LegacyRedirect to="/admin/communications" tab="announcements" />
          }
        />
        <Route
          path="announcements"
          element={<LegacyRedirect to="/admin/communications" tab="history" />}
        />
        <Route
          path="shares"
          element={<LegacyRedirect to="/admin/communications" tab="shares" />}
        />

        {/* Legacy settings pages. */}
        <Route
          path="ops"
          element={<LegacyRedirect to="/admin/settings" tab="general" />}
        />
        <Route
          path="email"
          element={<LegacyRedirect to="/admin/settings" tab="email" />}
        />
        <Route
          path="oauth"
          element={<LegacyRedirect to="/admin/settings" tab="oauth" />}
        />
        <Route
          path="security"
          element={<LegacyRedirect to="/admin/settings" tab="security" />}
        />
        <Route
          path="traffic"
          element={<LegacyRedirect to="/admin/settings" tab="traffic" />}
        />
        <Route
          path="observability"
          element={<LegacyRedirect to="/admin/settings" tab="observability" />}
        />
        <Route
          path="demo"
          element={<LegacyRedirect to="/admin/settings" tab="demo" />}
        />

        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}

export default function AdminApp() {
  return (
    <AdminAuthProvider>
      <AdminGate />
    </AdminAuthProvider>
  );
}
