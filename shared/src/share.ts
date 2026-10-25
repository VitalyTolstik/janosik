/**
 * Public read-only board sharing (TASK-58, §7.9) — the wire contract between
 * the public `/share/:token` contour and the UI.
 *
 * A share is its own entity (token + mode + privacy flags + TTL + revoke),
 * never a "public" flag on a board: a link can be handed out, embedded and
 * revoked independently, and the public contour has *no* write routes at all.
 */

import type { Board } from "./types/kanban";
import type { UserAvatarColor } from "./types/account";

/**
 * How a share serves the board:
 * - `snapshot` — a frozen `BoardEnvelope` captured at creation, rendered from
 *   JSON; it survives the source board being deleted, and only the owner can
 *   refresh it.
 * - `live` — reads the board as it is now and follows it over SSE; it dies
 *   together with the board (410) or when revoked/expired (404).
 */
export type BoardShareMode = "snapshot" | "live";

/** How long a fresh share lives, offered as presets in the UI. */
export const SHARE_TTL_HOURS = [1, 24, 168, 720] as const;

/** Hard caps and defaults for share creation (mirrored by the backend DTOs). */
export const SHARE_LIMITS = {
  /** Random bytes behind a token → 128 bits, base64url ≈ 22 chars. */
  tokenBytes: 16,
  /** Owner-side label length. */
  titleMax: 100,
  /** Comments visible by default for a live share (mirrors a board view). */
  defaultIncludeCommentsLive: true,
  /** Comments hidden by default for a snapshot (forward a board, not a chat). */
  defaultIncludeCommentsSnapshot: false,
  /** Attachments are opt-in on both modes (blob exposure). */
  defaultIncludeAttachments: false,
  /**
   * Requests per minute, per token, on the public contour (§7.9.4). A viewer
   * loads the page once plus the SSE stream, so this is generous but still
   * bounds one hammered link from any number of IPs.
   */
  rateLimitPerMinute: 240,
  /** The preview image is heavier to render — a tighter sub-limit. */
  ogRateLimitPerMinute: 60,
} as const;

/** A public-safe board member: never an email, only the visuals. */
export interface PublicBoardMemberDto {
  id: string;
  displayName: string | null;
  avatarColor: UserAvatarColor | null;
  avatarPath: string | null;
}

/** One row of the owner's/admin's share list. The token round-trips so a link can be re-copied. */
export interface BoardShareDto {
  id: string;
  token: string;
  boardId: string;
  boardTitle: string | null;
  mode: BoardShareMode;
  title: string | null;
  includeComments: boolean;
  includeAttachments: boolean;
  /** Unix ms expiry; `null` = no expiry. */
  expiresAt: number | null;
  /** Unix ms revoke time; `null` while active. */
  revokedAt: number | null;
  views: number;
  lastViewedAt: number | null;
  createdAt: number;
  createdBy: string;
}

/** Body of `POST /boards/:id/shares` (ADMIN). */
export interface CreateShareRequest {
  mode: BoardShareMode;
  title?: string | null;
  includeComments?: boolean;
  includeAttachments?: boolean;
  /** ISO-8601 expiry; omitted/`null` = no expiry. */
  expiresAt?: string | null;
}

/** Body of `PATCH /shares/:id` (owner/admin). */
export interface UpdateShareRequest {
  title?: string | null;
  includeComments?: boolean;
  includeAttachments?: boolean;
  /** `null` clears the expiry; omitted keeps the current value. */
  expiresAt?: string | null;
}

/**
 * Body of `GET /share/:token` — the whole public payload (no auth). `board`
 * is the live aggregate or the frozen snapshot; `members` is a sanitized
 * directory (displayName/avatar only) so assignee faces resolve without
 * leaking a single email.
 */
export interface PublicBoardDto {
  mode: BoardShareMode;
  /** Owner-side label, when the share was named. */
  title: string | null;
  /** Unix ms the snapshot was taken (snapshot mode); `null` for live. */
  takenAt: number | null;
  board: Board;
  /**
   * The board command `seq` the aggregate reflects (live mode) — the SSE
   * baseline the public page resumes from; `null` for a snapshot.
   */
  seq: number | null;
  members: PublicBoardMemberDto[];
  includeComments: boolean;
  includeAttachments: boolean;
}

/** `GET /share/:token/og.png` is served as `image/png`; no body contract. */
