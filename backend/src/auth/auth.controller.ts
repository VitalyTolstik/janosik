import {
  Controller,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Post,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

/**
 * Заглушки auth-роутов (тела появятся в TASK-24). Rate-limit ставим сразу:
 * 5 попыток в минуту на IP — самая жёсткая квота API (подбор пароля).
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
