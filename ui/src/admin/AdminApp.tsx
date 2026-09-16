import { Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { AdminAuthProvider, useAdminAuth } from "./AdminAuthContext";
import { AdminLoginPage } from "./AdminLoginPage";
import { AdminShell } from "./AdminShell";
import { DashboardPage } from "./DashboardPage";
import { UsersPage } from "./UsersPage";
import { BoardsPage } from "./BoardsPage";
import { AuditPage, LogPage } from "./LogAuditPages";
import { MastersPage } from "./MastersPage";

/**
 * Master panel entry (TASK-36), lazy-loaded from `/admin/*`.
 *
 * Isolation is structural: the admin route tree never mounts the user
 * `AuthProvider`/`BoardProvider`, and the panel talks through its own API
 * client with its own token. The two sessions cannot leak into each other.
 */

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
        <Route path="users" element={<UsersPage />} />
        <Route path="boards" element={<BoardsPage />} />
        <Route path="log" element={<LogPage />} />
        <Route path="audit" element={<AuditPage />} />
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
