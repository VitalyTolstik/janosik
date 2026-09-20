import { Navigate, Route, Routes, useParams } from "react-router-dom";
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
import { MastersPage } from "./MastersPage";
import { BoardContentPage } from "./BoardContentPage";

/**
 * Master panel entry (TASK-36), lazy-loaded from `/admin/*`.
 *
 * Isolation is structural: the admin route tree never mounts the user
 * `AuthProvider`/`BoardProvider`, and the panel talks through its own API
 * client with its own token. The two sessions cannot leak into each other.
 *
 * TASK-48: every entity list is the same generic `EntityPage` driven by a
 * per-entity config; users, boards and cards additionally expose detail
 * pages with the full relationship graph.
 */

function EntityRoute({
  entity,
}: {
  entity: Parameters<typeof useEntityConfig>[0];
}) {
  const config = useEntityConfig(entity);
  return <EntityPage config={config} />;
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
        <Route path="boards" element={<EntityRoute entity="boards" />} />
        <Route path="boards/:boardId" element={<BoardDetailRoute />} />
        <Route path="boards/:boardId/content" element={<BoardContentPage />} />
        <Route path="cards" element={<EntityRoute entity="cards" />} />
        <Route path="cards/:cardId" element={<CardDetailRoute />} />
        <Route path="columns" element={<EntityRoute entity="columns" />} />
        <Route path="labels" element={<EntityRoute entity="labels" />} />
        <Route
          path="checklists"
          element={<EntityRoute entity="checklists" />}
        />
        <Route path="cardLinks" element={<EntityRoute entity="cardLinks" />} />
        <Route path="comments" element={<EntityRoute entity="comments" />} />
        <Route
          path="attachments"
          element={<EntityRoute entity="attachments" />}
        />
        <Route path="activity" element={<EntityRoute entity="activity" />} />
        <Route path="commands" element={<EntityRoute entity="commands" />} />
        <Route path="log" element={<Navigate to="/admin/commands" replace />} />
        <Route path="sessions" element={<EntityRoute entity="sessions" />} />
        <Route path="tokens" element={<EntityRoute entity="tokens" />} />
        <Route path="audit" element={<EntityRoute entity="audit" />} />
        <Route path="masters" element={<MastersPage />} />
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
