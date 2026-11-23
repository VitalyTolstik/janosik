import { Global, Module } from "@nestjs/common";
import { RealtimeModule } from "@/realtime/realtime.module";
import {
  defaultHotPathCacheConfig,
  HOT_PATH_CACHE_CONFIG,
  HotPathCacheService,
} from "./hot-path-cache.service";

/**
 * TASK-200.5: one process-wide hot-path cache shared by auth, membership,
 * feature flags and the SSE keep-alive. Global because `MembershipGuard` is
 * instantiated by several feature modules; a per-module cache would multiply
 * entries and split invalidation.
 */
@Global()
@Module({
  imports: [RealtimeModule],
  providers: [
    {
      provide: HOT_PATH_CACHE_CONFIG,
      useFactory: defaultHotPathCacheConfig,
    },
    HotPathCacheService,
  ],
  exports: [HotPathCacheService, HOT_PATH_CACHE_CONFIG],
})
export class HotPathCacheModule {}
