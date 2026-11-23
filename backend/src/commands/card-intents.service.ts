import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Role } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type {
  ActorType,
  BoardAction,
  CardClaimIntentResponse,
  CardContextDto,
  CardIntentResponse,
  CardMoveIntentResponse,
  CommandResponse,
  EntityVersions,
} from "@janosik/shared";
import {
  CLAIM_LEASE_DEFAULT_MS,
  CLAIM_LEASE_MAX_MS,
  CLAIM_LEASE_MIN_MS,
  workflowDoneColumnIds,
} from "@janosik/shared";

import type { RequestAttribution } from "@/auth/request-attribution";
import type { AuthPrincipal } from "@/auth/auth-principal";
import { PrismaService } from "@/common/prisma/prisma.service";
import type { CreateCommandDto } from "./dto/create-command.dto";
import {
  ClaimCardIntentDto,
  MoveCardIntentDto,
  PatchCardIntentDto,
} from "./dto/card-intent.dto";
import { CommandsService } from "./commands.service";
import { loadTargetedBoardAggregate } from "./targeted-board";

/** The authenticated caller attributes the command transport resolved. */
export interface CardIntentActor {
  actorId: string;
  actorType: ActorType;
  actorRole: Role;
  attribution: RequestAttribution;
  principal?: AuthPrincipal;
  approvalId?: string;
}

/** A stored command, narrowed to what an intent replay needs. */
interface StoredIntentCommand {
  boardId: string;
  payload: Prisma.JsonValue;
  result: Prisma.JsonValue;
  runId: string | null;
}

interface ReplayedCommand {
  response: CommandResponse;
  action: Record<string, unknown>;
}

/**
 * TASK-200.7: card intents are the agent path that does not need a board
 * aggregate. Each one resolves the card (and, for a move, the source and
 * destination column order only) with `loadTargetedBoardAggregate`, builds the
 * same reducer action the command log uses, and applies it through
 * `CommandsService` with the `targeted` loader. Idempotency, approvals, agent
 * policy, WIP/workflow, run pre-images and the SSE command log therefore stay
 * on one code path.
 *
 * An exact retry is answered from the stored command before the server-derived
 * action is rebuilt. Claim recomputes `leaseUntil`, move recomputes the source
 * index and patch may race a foreign description edit; without this lookup the
 * same `commandId` would look like a different payload (or a stale
 * precondition) instead of the idempotent replay it is.
 */
@Injectable()
export class CardIntentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commands: CommandsService,
  ) {}

  /** Small card context: one card, its column order and the board shell. */
  async context(boardId: string, cardId: string): Promise<CardContextDto> {
    const loaded = await this.load(boardId, cardId, { index: true });
    const card = loaded.cards[0];
    if (card === undefined) throw new NotFoundException("Card not found");
    const aggregate = loaded.board;
    const column =
      aggregate.columns.find((entry) => entry.cardIds.includes(cardId)) ?? null;
    const seq = await this.commands.latestSeq(boardId);
    return {
      boardId,
      card: aggregate.cards[cardId]!,
      columnId: column?.id ?? null,
      cardIndex:
        column === null ? null : Math.max(0, column.cardIds.indexOf(cardId)),
      columns: aggregate.columns.map((entry) => ({
        id: entry.id,
        title: entry.title,
      })),
      doneColumnIds: workflowDoneColumnIds(aggregate),
      ...(aggregate.workflow !== undefined
        ? { workflow: aggregate.workflow }
        : {}),
      seq,
      versions: loaded.versions,
    };
  }

  async claim(
    boardId: string,
    cardId: string,
    dto: ClaimCardIntentDto,
    actor: CardIntentActor,
  ): Promise<CardClaimIntentResponse> {
    const release = dto.release === true;
    const replay = await this.replay(
      boardId,
      cardId,
      dto.commandId,
      "CLAIM_CARD",
      (payload) =>
        (payload.claimedBy ?? null) === (release ? null : actor.actorId),
    );
    if (replay !== null) {
      return this.claimResponse(replay.response, boardId, cardId);
    }

    // Only the card matters for a claim; no board-wide order is read.
    const versions = await this.cardVersion(boardId, cardId);
    const duration = Math.min(
      Math.max(dto.leaseMs ?? CLAIM_LEASE_DEFAULT_MS, CLAIM_LEASE_MIN_MS),
      CLAIM_LEASE_MAX_MS,
    );
    const leaseUntil = release ? null : Date.now() + duration;
    const claimedBy = release ? null : actor.actorId;
    const response = await this.apply(
      boardId,
      actor,
      dto,
      {
        type: "CLAIM_CARD",
        boardId,
        at: Date.now(),
        cardId,
        claimedBy,
        leaseUntil,
      } as BoardAction,
      versions,
    );
    return this.claimResponse(response, boardId, cardId);
  }

  async move(
    boardId: string,
    cardId: string,
    dto: MoveCardIntentDto,
    actor: CardIntentActor,
  ): Promise<CardMoveIntentResponse> {
    const replay = await this.replay(
      boardId,
      cardId,
      dto.commandId,
      "MOVE_CARD",
      (payload) =>
        dto.toColumnId === undefined || payload.toColumnId === dto.toColumnId,
    );
    if (replay !== null) {
      return this.moveResponse(replay.response, boardId, cardId, {
        fromColumnId: String(replay.action.fromColumnId ?? ""),
        toColumnId: String(replay.action.toColumnId ?? ""),
        toIndex: Number(replay.action.toIndex ?? 0),
      });
    }

    // The source and destination column orders are the only card lists a
    // move needs. The card version pinned below makes a concurrent move of
    // this same card a `409`; moving another card in either column is not a
    // conflict.
    const loaded = await this.load(boardId, cardId, {
      index: true,
      indexColumnIds:
        dto.toColumnId !== undefined ? [dto.toColumnId] : undefined,
    });
    const card = loaded.cards[0];
    if (card === undefined) throw new NotFoundException("Card not found");
    const archived = aggregateArchived(loaded.board, cardId);
    const source = loaded.board.columns.find((column) =>
      column.cardIds.includes(cardId),
    );
    if (archived) {
      throw new BadRequestException("Card is archived and cannot be moved");
    }
    if (source === undefined) {
      throw new BadRequestException(
        "Card is not in a live column and cannot be moved",
      );
    }
    const destinationId = dto.toColumnId ?? source.id;
    const destination = loaded.board.columns.find(
      (column) => column.id === destinationId,
    );
    if (destination === undefined) {
      throw new NotFoundException(`Column ${destinationId} not found`);
    }
    // Within one column the card's own slot does not count.
    const slots =
      destination.id === source.id
        ? destination.cardIds.length - 1
        : destination.cardIds.length;
    const toIndex =
      dto.position !== undefined ? Math.min(dto.position, slots) : slots;
    const action = {
      type: "MOVE_CARD",
      boardId,
      at: Date.now(),
      cardId,
      fromColumnId: source.id,
      fromIndex: Math.max(0, source.cardIds.indexOf(cardId)),
      toColumnId: destination.id,
      toIndex,
    } as BoardAction;
    const response = await this.apply(
      boardId,
      actor,
      dto,
      action,
      loaded.versions,
    );
    return this.moveResponse(response, boardId, cardId, {
      fromColumnId: source.id,
      toColumnId: destination.id,
      toIndex,
    });
  }

  async patch(
    boardId: string,
    cardId: string,
    dto: PatchCardIntentDto,
    actor: CardIntentActor,
  ): Promise<CardIntentResponse> {
    if (dto.title === undefined && dto.description === undefined) {
      throw new BadRequestException({
        message: "Pass title and/or description.",
        field: "title",
      });
    }
    const replay = await this.replay(
      boardId,
      cardId,
      dto.commandId,
      "UPDATE_CARD",
      (payload) =>
        (dto.title === undefined || payload.title === dto.title) &&
        (dto.description === undefined ||
          payload.description === dto.description),
    );
    if (replay !== null)
      return this.patchResponse(replay.response, boardId, cardId);

    const loaded = await this.load(boardId, cardId, {});
    const card = loaded.cards[0];
    if (card === undefined) throw new NotFoundException("Card not found");
    if (
      dto.expectedDescription !== undefined &&
      (card.description ?? "") !== dto.expectedDescription
    ) {
      throw new ConflictException({
        message: "Card description changed since it was read",
        code: "version_conflict",
        conflict: "version",
        field: "description",
        currentVersion: await this.commands.latestSeq(boardId),
        versions: loaded.versions,
      });
    }
    const response = await this.apply(
      boardId,
      actor,
      dto,
      {
        type: "UPDATE_CARD",
        boardId,
        at: Date.now(),
        cardId,
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
      } as BoardAction,
      loaded.versions,
    );
    return this.patchResponse(response, boardId, cardId);
  }

  private async claimResponse(
    response: CommandResponse,
    boardId: string,
    cardId: string,
  ): Promise<CardClaimIntentResponse> {
    const fresh = await this.cardSnapshot(boardId, cardId);
    return {
      ...response,
      card: fresh.card,
      columnId: fresh.columnId,
      claimedBy: fresh.card.claimedBy ?? null,
      leaseUntil: fresh.card.leaseUntil ?? null,
      results: [response],
    };
  }

  private async moveResponse(
    response: CommandResponse,
    boardId: string,
    cardId: string,
    action: {
      fromColumnId: string;
      toColumnId: string;
      toIndex: number;
    },
  ): Promise<CardMoveIntentResponse> {
    // The applied action already names the final column/index; only the card
    // payload and the destination title are needed afterwards. No second
    // column-index scan.
    const fresh = await this.cardSnapshot(boardId, cardId);
    const destination = fresh.columns.find(
      (column) => column.id === action.toColumnId,
    );
    return {
      ...response,
      card: fresh.card,
      columnId: action.toColumnId,
      fromColumnId: action.fromColumnId,
      toColumnId: action.toColumnId,
      toIndex: action.toIndex,
      columnTitle: destination?.title ?? "",
      results: [response],
    };
  }

  private async patchResponse(
    response: CommandResponse,
    boardId: string,
    cardId: string,
  ): Promise<CardIntentResponse> {
    const fresh = await this.cardSnapshot(boardId, cardId);
    return {
      ...response,
      card: fresh.card,
      columnId: fresh.columnId,
      results: [response],
    };
  }

  /** One card plus the column shell, without a card-order index scan. */
  private async cardSnapshot(
    boardId: string,
    cardId: string,
  ): Promise<{
    card: CardContextDto["card"];
    columnId: string | null;
    columns: CardContextDto["columns"];
  }> {
    const loaded = await this.load(boardId, cardId, {});
    const card = loaded.board.cards[cardId];
    if (card === undefined) throw new NotFoundException("Card not found");
    const column =
      loaded.board.columns.find((entry) => entry.cardIds.includes(cardId)) ??
      null;
    return {
      card,
      columnId: column?.id ?? null,
      columns: loaded.board.columns.map((entry) => ({
        id: entry.id,
        title: entry.title,
      })),
    };
  }

  /**
   * An exact retry returns the stored result before a server-derived action
   * or a stale-description precondition is evaluated. A different body under
   * the same key is still an idempotency conflict.
   */
  private async replay(
    boardId: string,
    cardId: string,
    commandId: string | undefined,
    type: BoardAction["type"],
    matches: (payload: Record<string, unknown>) => boolean,
  ): Promise<ReplayedCommand | null> {
    if (commandId === undefined) return null;
    const row = (await this.prisma.command.findUnique({
      where: { id: commandId },
      select: { boardId: true, payload: true, result: true, runId: true },
    })) as StoredIntentCommand | null;
    if (row === null) return null;
    if (row.boardId !== boardId) {
      throw new ConflictException({
        message: "commandId already used on another board",
        field: "commandId",
        code: "id_conflict",
        conflict: "id",
      });
    }
    const payload = asRecord(row.payload);
    if (
      payload === null ||
      payload.type !== type ||
      payload.cardId !== cardId ||
      !matches(payload)
    ) {
      throw new ConflictException({
        message: "commandId already used with a different payload",
        field: "commandId",
        code: "idempotency_conflict",
      });
    }
    const result = asRecord(row.result);
    if (result === null || typeof result.seq !== "number") return null;
    return {
      action: payload,
      response: {
        ...(result as unknown as CommandResponse),
        ...(row.runId !== null ? { runId: row.runId } : {}),
      },
    };
  }

  private async cardVersion(
    boardId: string,
    cardId: string,
  ): Promise<EntityVersions> {
    const row = await this.prisma.card.findFirst({
      where: { id: cardId, column: { boardId }, deletedAt: null },
      select: { version: true },
    });
    if (row === null) throw new NotFoundException("Card not found");
    return { [`card:${cardId}`]: row.version };
  }

  private async load(
    boardId: string,
    cardId: string,
    options: { index?: boolean; indexColumnIds?: readonly string[] },
  ) {
    const loaded = await loadTargetedBoardAggregate(
      this.prisma as unknown as Prisma.TransactionClient,
      boardId,
      {
        cardIds: [cardId],
        ...(options.indexColumnIds !== undefined
          ? { indexColumnIds: options.indexColumnIds }
          : {}),
        ...(options.index === true ? { includeTargetColumn: true } : {}),
      },
    );
    if (loaded === null) throw new NotFoundException("Board not found");
    return loaded;
  }

  private async apply(
    boardId: string,
    actor: CardIntentActor,
    dto: ClaimCardIntentDto | MoveCardIntentDto | PatchCardIntentDto,
    action: BoardAction,
    versions: EntityVersions,
  ): Promise<CommandResponse> {
    const cardId = (action as BoardAction & { cardId: string }).cardId;
    // A caller-supplied map wins; otherwise pin the version this intent read.
    // That is the same optimistic contract as an `ifMatchVersions` write,
    // with the read and the write kept to the touched card/columns.
    const preconditions =
      dto.ifMatchVersions ??
      (versions[`card:${cardId}`] !== undefined
        ? { [`card:${cardId}`]: versions[`card:${cardId}`]! }
        : undefined);
    const command: CreateCommandDto = {
      commandId: dto.commandId ?? randomUUID(),
      action: action as unknown as Record<string, unknown>,
      ...(dto.ifMatch !== undefined ? { ifMatch: dto.ifMatch } : {}),
      ...(preconditions !== undefined
        ? { ifMatchVersions: preconditions }
        : {}),
    };
    return this.commands.apply(boardId, actor.actorId, command, {
      actorType: actor.actorType,
      actorRole: actor.actorRole,
      attribution: actor.attribution,
      ...(actor.principal !== undefined ? { principal: actor.principal } : {}),
      ...(actor.approvalId !== undefined
        ? { approvalId: actor.approvalId }
        : {}),
      targeted: true,
    });
  }
}

/** An archived card is in the cards map but in no column. */
function aggregateArchived(
  board: { cards: Record<string, unknown> },
  cardId: string,
): boolean {
  const card = board.cards[cardId] as { archivedAt?: number } | undefined;
  return card?.archivedAt !== undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
