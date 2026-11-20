import {
  Activity,
  BarChart3,
  ClipboardList,
  FileText,
  Gauge,
  KanbanSquare,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  Paperclip,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";

import type { AdminMessageKey } from "../admin-i18n";

/**
 * The eight-hub information architecture (admin redesign).
 *
 * 26 legacy destinations stay reachable: each one is a tab inside a hub and
 * every old URL redirects with its query string intact. The sidebar only
 * offers the eight decisions an operator actually makes; the command palette
 * covers the long tail.
 */

export type AdminHubKey =
  | "overview"
  | "users"
  | "boards"
  | "moderation"
  | "audit"
  | "communications"
  | "access"
  | "settings";

export interface AdminHub {
  key: AdminHubKey;
  to: string;
  labelKey: AdminMessageKey;
  icon: typeof LayoutDashboard;
}

export const ADMIN_HUBS: AdminHub[] = [
  {
    key: "overview",
    to: "/admin",
    labelKey: "admin.hub.overview",
    icon: LayoutDashboard,
  },
  {
    key: "users",
    to: "/admin/users",
    labelKey: "admin.hub.users",
    icon: Users,
  },
  {
    key: "boards",
    to: "/admin/boards",
    labelKey: "admin.hub.boards",
    icon: KanbanSquare,
  },
  {
    key: "moderation",
    to: "/admin/moderation",
    labelKey: "admin.hub.moderation",
    icon: MessageSquare,
  },
  {
    key: "audit",
    to: "/admin/audit",
    labelKey: "admin.hub.audit",
    icon: ScrollText,
  },
  {
    key: "communications",
    to: "/admin/communications",
    labelKey: "admin.hub.communications",
    icon: Megaphone,
  },
  {
    key: "access",
    to: "/admin/access",
    labelKey: "admin.hub.access",
    icon: ShieldCheck,
  },
  {
    key: "settings",
    to: "/admin/settings",
    labelKey: "admin.hub.settings",
    icon: Settings,
  },
];

export const ADMIN_NAV_GROUPS: Array<{
  labelKey: AdminMessageKey;
  keys: AdminHubKey[];
}> = [
  {
    labelKey: "admin.hub.group.operate",
    keys: ["overview", "users", "boards", "moderation"],
  },
  {
    labelKey: "admin.hub.group.govern",
    keys: ["audit", "communications"],
  },
  {
    labelKey: "admin.hub.group.configure",
    keys: ["access", "settings"],
  },
];

export interface HubTab {
  key: string;
  labelKey: AdminMessageKey;
  /** Legacy URL this tab replaced; used for redirects and documentation. */
  legacyPath?: string;
  icon?: typeof LayoutDashboard;
  ownerOnly?: boolean;
  preserves?: readonly "boardId"[];
}

export const HUB_TABS: Record<AdminHubKey, HubTab[]> = {
  overview: [],
  users: [],
  boards: [
    {
      key: "boards",
      labelKey: "admin.nav.boards",
      legacyPath: "/admin/boards",
      preserves: ["boardId"],
      icon: KanbanSquare,
    },
    {
      key: "cards",
      labelKey: "admin.nav.cards",
      legacyPath: "/admin/cards",
      preserves: ["boardId"],
      icon: FileText,
    },
    {
      key: "columns",
      labelKey: "admin.nav.columns",
      legacyPath: "/admin/columns",
      preserves: ["boardId"],
      icon: KanbanSquare,
    },
    {
      key: "labels",
      labelKey: "admin.nav.labels",
      legacyPath: "/admin/labels",
      preserves: ["boardId"],
      icon: KanbanSquare,
    },
    {
      key: "checklists",
      labelKey: "admin.nav.checklists",
      legacyPath: "/admin/checklists",
      preserves: ["boardId"],
      icon: KanbanSquare,
    },
    {
      key: "links",
      labelKey: "admin.nav.cardLinks",
      legacyPath: "/admin/cardLinks",
      preserves: ["boardId"],
      icon: KanbanSquare,
    },
  ],
  moderation: [
    {
      key: "comments",
      labelKey: "admin.nav.comments",
      legacyPath: "/admin/comments",
      preserves: ["boardId"],
      icon: MessageSquare,
    },
    {
      key: "attachments",
      labelKey: "admin.nav.attachments",
      legacyPath: "/admin/attachments",
      preserves: ["boardId"],
      icon: Paperclip,
    },
  ],
  audit: [
    {
      key: "audit",
      labelKey: "admin.nav.audit",
      legacyPath: "/admin/audit",
      icon: ScrollText,
    },
    {
      key: "commands",
      labelKey: "admin.nav.log",
      legacyPath: "/admin/commands",
      preserves: ["boardId"],
      icon: ClipboardList,
    },
    {
      key: "activity",
      labelKey: "admin.nav.activity",
      legacyPath: "/admin/activity",
      preserves: ["boardId"],
      icon: Activity,
    },
  ],
  communications: [
    {
      key: "announcements",
      labelKey: "admin.nav.comms",
      legacyPath: "/admin/comms",
      icon: Megaphone,
    },
    {
      key: "history",
      labelKey: "admin.nav.announcements",
      legacyPath: "/admin/announcements",
      icon: Megaphone,
    },
    {
      key: "shares",
      labelKey: "admin.nav.shares",
      legacyPath: "/admin/shares",
      icon: Megaphone,
    },
  ],
  access: [
    {
      key: "sessions",
      labelKey: "admin.nav.sessions",
      legacyPath: "/admin/sessions",
      icon: ShieldCheck,
    },
    {
      key: "tokens",
      labelKey: "admin.nav.tokens",
      legacyPath: "/admin/tokens",
      icon: KeyRound,
    },
    {
      key: "masters",
      labelKey: "admin.nav.masters",
      legacyPath: "/admin/masters",
      icon: ShieldCheck,
      ownerOnly: true,
    },
  ],
  settings: [
    {
      key: "general",
      labelKey: "admin.nav.ops",
      legacyPath: "/admin/ops",
      icon: Settings,
    },
    {
      key: "email",
      labelKey: "admin.nav.email",
      legacyPath: "/admin/email",
      icon: Megaphone,
      ownerOnly: true,
    },
    {
      key: "oauth",
      labelKey: "admin.nav.oauth",
      legacyPath: "/admin/oauth",
      icon: ShieldCheck,
      ownerOnly: true,
    },
    {
      key: "security",
      labelKey: "admin.nav.security",
      legacyPath: "/admin/security",
      icon: ShieldCheck,
    },
    {
      key: "traffic",
      labelKey: "admin.nav.traffic",
      legacyPath: "/admin/traffic",
      icon: Gauge,
      ownerOnly: true,
    },
    {
      key: "observability",
      labelKey: "admin.nav.observability",
      legacyPath: "/admin/observability",
      icon: BarChart3,
    },
    {
      key: "demo",
      labelKey: "admin.nav.demo",
      legacyPath: "/admin/demo",
      icon: Activity,
      ownerOnly: true,
    },
  ],
};

/** Default tab for a hub when no `?tab=` is present. */
export const HUB_DEFAULT_TAB: Partial<Record<AdminHubKey, string>> = {
  boards: "boards",
  moderation: "comments",
  audit: "audit",
  communications: "announcements",
  access: "sessions",
  settings: "general",
};

export function hubTabHref(hub: AdminHubKey, tab: string): string {
  const base = ADMIN_HUBS.find((entry) => entry.key === hub)?.to;
  if (base === undefined) return "/admin";
  return `${base}?tab=${encodeURIComponent(tab)}`;
}

export function hubForPath(pathname: string): AdminHubKey | null {
  if (pathname === "/admin" || pathname === "/admin/") return "overview";
  const entry = ADMIN_HUBS.find(
    (hub) =>
      hub.key !== "overview" &&
      (pathname === hub.to || pathname.startsWith(`${hub.to}/`)),
  );
  if (entry !== undefined) return entry.key;
  if (/^\/admin\/cards\/[^/]+\/?$/.test(pathname)) return "boards";
  return null;
}

const DETAIL_DESTINATIONS: Array<{
  path: RegExp;
  labelKey: AdminMessageKey;
  icon: AdminHub["icon"];
}> = [
  {
    path: /^\/admin\/users\/[^/]+\/?$/,
    labelKey: "admin.crumb.userDetail",
    icon: Users,
  },
  {
    path: /^\/admin\/boards\/[^/]+\/?$/,
    labelKey: "admin.crumb.boardDetail",
    icon: KanbanSquare,
  },
  {
    path: /^\/admin\/boards\/[^/]+\/content\/?$/,
    labelKey: "admin.crumb.boardContent",
    icon: FileText,
  },
  {
    path: /^\/admin\/boards\/[^/]+\/workflow\/?$/,
    labelKey: "admin.crumb.boardWorkflow",
    icon: Workflow,
  },
  {
    path: /^\/admin\/cards\/[^/]+\/?$/,
    labelKey: "admin.crumb.cardDetail",
    icon: FileText,
  },
];

export function adminDestination(pathname: string, search = "") {
  const hub = ADMIN_HUBS.find((entry) => entry.key === hubForPath(pathname));
  if (hub === undefined) return null;
  const tabKey = new URLSearchParams(search).get("tab");
  return {
    hub,
    tab: HUB_TABS[hub.key].find((tab) => tab.key === tabKey),
    detail: DETAIL_DESTINATIONS.find((entry) => entry.path.test(pathname)),
  };
}

/** Keyboard `g` sequences documented in the panel's shortcut help. */
export const HUB_SHORTCUTS: Record<string, AdminHubKey> = {
  KeyD: "overview",
  KeyU: "users",
  KeyB: "boards",
  KeyM: "moderation",
  KeyA: "audit",
  KeyC: "communications",
  KeyS: "access",
  Comma: "settings",
};
