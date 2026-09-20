import type { UserAvatarColor } from "@janosik/shared";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAvatarObjectUrl } from "@/hooks/use-avatar-object-url";
import { cn } from "@/lib/utils";
import { userAvatarColor, userInitials, userLabel } from "@/utils/avatar";

/**
 * User avatar — initials on the color the user picked (TASK-36.1) or the
 * stable id-hash default, with the full name in a tooltip. The base brick
 * for member lists (TASK-35) and presence/attribution (TASK-36); the palette
 * mirrors the board avatars, so both families of avatars read as one design
 * language.
 */

const AVATAR_SIZES = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZES;

interface UserAvatarProps {
  userId: string;
  displayName: string | null;
  email: string;
  /** Picked palette color; `null`/omitted → the id-hash default. */
  color?: UserAvatarColor | null;
  /**
   * Stored avatar image name (TASK-47). When set, the image is fetched once
   * (authenticated blob → object URL, module-cached) and rendered over the
   * initials; `null`/omitted keeps the initials.
   */
  avatarPath?: string | null;
  /** Overrides the resolved image source (tests, previews). */
  src?: string | null;
  size?: AvatarSize;
  className?: string;
}

export function UserAvatar({
  userId,
  displayName,
  email,
  color = null,
  avatarPath,
  src: srcOverride,
  size = "md",
  className,
}: UserAvatarProps) {
  const label = userLabel(displayName, email);
  const fetched = useAvatarObjectUrl(userId, avatarPath);
  const src = srcOverride ?? fetched;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          data-testid="user-avatar"
          className={cn(
            "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold leading-none text-white",
            AVATAR_SIZES[size],
            src ? undefined : userAvatarColor(userId, color),
            className,
          )}
        >
          {src ? (
            <img
              src={src}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            userInitials(displayName, email)
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
