import {
  Controller,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Post,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

/**
 * Auth route stubs (bodies land in TASK-24). Rate limiting is set up right
 * away: 5 attempts per minute per IP — the strictest API quota (password
 * brute force).
 */
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Controller("auth")
export class AuthController {
  @Post("register")
  register(): never {
    throw new NotImplementedException();
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(): never {
    throw new NotImplementedException();
  }
}
