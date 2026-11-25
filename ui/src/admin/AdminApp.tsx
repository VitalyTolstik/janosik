import { lazy } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AdminAuthProvider, useAdminAuth } from "./AdminAuthContext";
import { AdminLoginPage } from "./AdminLoginPage";
import { AdminShell } from "./AdminShell";
import { useAdminT } from "./admin-i18n";
import { DashboardPage } from "./DashboardPage";
import { UserDetailPage } from "./UserDetailPage";
import { CardDetailPage } from "./CardDetailPage";
import { BoardDetailPage } from "./BoardDetailPage";
import { BoardContentPage } from "./BoardContentPage";
import { BoardWorkflowPage } from "./BoardWorkflowPage";
import { SettingsHubPage } from "./hubs/SettingsHubPage";

// List routes share the filter registry and URL state code. Detail routes
// can open directly without loading either.
const UsersPage = lazy(() => import("./UsersPage"));
const BoardsHubPage = lazy(() =>
  import("./hubs/BoardsHubPage").then(({ BoardsHubPage }) => ({
    default: BoardsHubPage,
  })),
);
const ModerationHubPage = lazy(() =>
  import("./hubs/ModerationHubPage").then(({ ModerationHubPage }) => ({
    default: ModerationHubPage,
  })),
);
const AuditHubPage = lazy(() =>
  import("./hubs/AuditHubPage").then(({ AuditHubPage }) => ({
    default: AuditHubPage,
  })),
);
const AccessHubPage = lazy(() =>
  import("./hubs/AccessHubPage").then(({ AccessHubPage }) => ({
    default: AccessHubPage,
  })),
);
const CommunicationsHubPage = lazy(() =>
  import("./hubs/CommunicationsHubPage").then(({ CommunicationsHubPage }) => ({
    default: CommunicationsHubPage,
  })),
);

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
  const t = useAdminT();
  const { status, recovering, recoveryFailed, retryRefresh, signIn } =
    useAdminAuth();

  if (status === "boot") {
    if (recoveryFailed !== null) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
          <p
            className="max-w-sm text-ui-label text-(--agent-tone-danger)"
            data-testid="admin-boot-failed"
            role="alert"
          >
            {t(
              recoveryFailed === "rateLimited"
                ? "admin.boot.failed.rateLimited"
                : "admin.boot.failed.unavailable",
            )}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button size="sm" onClick={retryRefresh}>
              {t("admin.common.retry")}
            </Button>
            <Button size="sm" variant="outline" onClick={signIn}>
              {t("admin.boot.signIn")}
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <Loader2
          className="h-5 w-5 animate-spin text-muted-foreground"
          aria-hidden
        />
        {recovering ? (
          <p
            className="max-w-sm text-ui-label text-muted-foreground"
            data-testid="admin-boot-recovering"
            role="status"
          >
            {t(
              recovering === "rateLimited"
                ? "admin.boot.recovering.rateLimited"
                : "admin.boot.recovering.unavailable",
            )}
          </p>
        ) : null}
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

        <Route path="users" element={<UsersPage />} />
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
