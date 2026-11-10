import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { type BoardMember, Role } from "@prisma/client";
import type {
  CommandBatchResponse,
  CommandDeltaEntry,
  CommandResponse,
} from "@janosik/shared";
import type { AuthUser } from "@/auth/auth.types";
import type { AgentSessionContext, AuthPrincipal } from "@/auth/auth-principal";
import {
  actorTypeOf,
  CurrentAgentSession,
  CurrentPrincipal,
} from "@/auth/auth-principal";
import { requestAttribution } from "@/auth/request-attribution";
import { CurrentUser } from "@/auth/current-user.decorator";
import { BoardRoles } from "@/common/board-roles.decorator";
import { CurrentMembership } from "@/common/current-membership.decorator";
import {
  hashIdempotentRequest,
  idempotencyActorKey,
  IdempotencyService,
  normalizeIdempotencyKey,
} from "@/common/idempotency.service";
import { MembershipGuard } from "@/common/membership.guard";
import { CommandsService } from "./commands.service";
import { CreateCommandBatchDto } from "./dto/create-command-batch.dto";
import { CreateCommandDto } from "./dto/create-command.dto";
import { parseSince } from "./parse-since";

/** Response header of a delta that must not be trusted (B-3). */
export const DELTA_RESYNC_HEADER = "X-Delta-Resync";

/**
 * Command transport (§7.4): `POST /boards/:id/commands` applies a reducer
 * action; `GET .../commands?since=` is the delta catch-up after an SSE gap.
 *
 * `MembershipGuard` resolves the board and enforces roles: mutations are
 * ADMIN/MEMBER only (VIEWER reads), while the delta feed is readable by any
 * member, VIEWER included.
 */
@Controller("boards/:id/commands")
export class CommandsController {
  constructor(
    private readonly commands: CommandsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN, Role.MEMBER)
  @Post()
  @HttpCode(HttpStatus.OK)
  async create(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @CurrentMembership() membership: BoardMember,
    @Headers("x-approval-id") approvalId: string | undefined,
    @Body() dto: CreateCommandDto,
    @Headers("idempotency-key") rawKey?: string,
  ): Promise<CommandResponse> {
    const apply = (): Promise<CommandResponse> =>
      this.commands.apply(id, user.id, dto, {
        actorType: actorTypeOf(principal),
        actorRole: membership.role,
        attribution: requestAttribution(principal, session?.id),
        principal,
        ...(approvalId !== undefined ? { approvalId } : {}),
      });
    // Commands are already idempotent through `commandId`; the ADR's
    // `duplicate_card` operation additionally accepts the REST-level
    // `Idempotency-Key` so an agent can retry a whole tool call.
    if (dto.action.type !== "DUPLICATE_CARD") return apply();
    const action = dto.action;
    const outcome = await this.idempotency.run({
      scope: "duplicate_card",
      key: normalizeIdempotencyKey(rawKey),
      actorKey: idempotencyActorKey(user.id, principal),
      // `at` and `commandId` are transport stamps, not intent: an honest
      // retry may carry a later clock and still must replay.
      requestHash: hashIdempotentRequest({
        boardId: id,
        type: action.type,
        cardId: action.cardId,
        newCardId: action.newCardId,
        title: action.title,
      }),
      run: async () => {
        const response = await apply();
        return {
          body: response,
          status: 200,
          resourceId:
            typeof dto.action.newCardId === "string"
              ? dto.action.newCardId
              : null,
        };
      },
    });
    return outcome.body;
  }

  /**
   * Apply several commands in one transaction (TASK-160): one board lock and
   * one aggregate load for the whole batch, so an agent's multi-step edit
   * (create a card, then set its fields) is one round-trip instead of one per
   * command. All-or-nothing — any command's failure rolls the batch back.
   */
  @UseGuards(MembershipGuard)
  @BoardRoles(Role.ADMIN, Role.MEMBER)
  @Post("batch")
  @HttpCode(HttpStatus.OK)
  async batch(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @CurrentPrincipal() principal: AuthPrincipal | undefined,
    @CurrentAgentSession() session: AgentSessionContext | undefined,
    @CurrentMembership() membership: BoardMember,
    @Headers("x-approval-id") approvalId: string | undefined,
    @Body() dto: CreateCommandBatchDto,
  ): Promise<CommandBatchResponse> {
    const results = await this.commands.applyBatch(id, user.id, dto.commands, {
      actorType: actorTypeOf(principal),
      actorRole: membership.role,
      attribution: requestAttribution(principal, session?.id),
      principal,
      // TASK-166.7: a PAT batch always creates one board-scoped run. A browser
      // batch stays outside the run log (D16) and keeps its local undo.
      ...(principal?.via === "pat"
        ? {
            run: {
              kind: "batch" as const,
              ...(dto.clientRunId !== undefined
                ? { clientRunId: dto.clientRunId }
                : {}),
            },
          }
        : {}),
      ...(approvalId !== undefined ? { approvalId } : {}),
    });
    return { runId: results.runId, results: results.results };
  }

  /**
   * The delta since `?since=`. B-3: when the gap cannot be replayed (the
   * page hit its cap, or the baseline was trimmed from the log) the answer
   * carries `X-Delta-Resync: 1` and an empty body — the client must re-read
   * the board (`GET /boards/:id` + `X-Board-Seq`) instead of applying a
   * partial history.
   */
  @UseGuards(MembershipGuard)
  @Get()
  async list(
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
    @Query("since") since?: string,
    @Query("runId") runId?: string,
    @Query("apiTokenId") apiTokenId?: string,
    @Query("agentSessionId") agentSessionId?: string,
  ): Promise<CommandDeltaEntry[]> {
    const delta = await this.commands.deltaSince(
      id,
      parseSince(since),
      undefined,
      {
        ...(runId !== undefined && runId !== "" ? { runId } : {}),
        ...(apiTokenId !== undefined && apiTokenId !== ""
          ? { apiTokenId }
          : {}),
        ...(agentSessionId !== undefined && agentSessionId !== ""
          ? { agentSessionId }
          : {}),
      },
    );
    if (delta.resync) {
      res.setHeader(DELTA_RESYNC_HEADER, "1");
      return [];
    }
    return delta.entries;
  }
}
