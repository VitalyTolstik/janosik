import type { UserAvatarColor } from "@janosik/shared";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  size?: AvatarSize;
  className?: string;
}

export function UserAvatar({
  userId,
  displayName,
  email,
  color = null,
  size = "md",
  className,
}: UserAvatarProps) {
  const label = userLabel(displayName, email);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          data-testid="user-avatar"
          className={cn(
            "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none text-white",
            AVATAR_SIZES[size],
            userAvatarColor(userId, color),
            className,
          )}
        >
          {userInitials(displayName, email)}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
