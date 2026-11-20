import { env } from "@/config/env";
import {
  securityStamp as stampWithSecret,
  type StampUser,
} from "./security-stamp-hmac";

/** Changes whenever credentials or mailbox ownership change. */
export function securityStamp(
  user: StampUser,
  secret = env.JWT_SECRET,
): string {
  return stampWithSecret(user, secret);
}
