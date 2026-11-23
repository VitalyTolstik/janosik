import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
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

/**
 * TASK-200.7: card intents are the agent path that does not need a board
 * aggregate. Each one resolves the card (and, for a move, the column order)
 * with `loadTargetedBoardAggregate`, builds the same reducer action the
 * command log uses, and applies it through `CommandsService` with the
 * `targeted` loader. Idempotency, approvals, agent policy, WIP/workflow,
 * run pre-images and the SSE command log therefore stay on one code path.
 */
@Injectable()
export class CardIntentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commands: CommandsService,
  ) {}

  /** Small card context for DoD checks, release checks and description CAS. */
  async context(boardId: string, cardId: string): Promise<CardContextDto> {
    const loaded = await this.load(boardId, cardId, true);
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
    const loaded = await this.load(boardId, cardId, false);
    if (loaded.cards.length === 0)
      throw new NotFoundException("Card not found");

    const duration = Math.min(
      Math.max(dto.leaseMs ?? CLAIM_LEASE_DEFAULT_MS, CLAIM_LEASE_MIN_MS),
      CLAIM_LEASE_MAX_MS,
    );
    const leaseUntil = dto.release === true ? null : Date.now() + duration;
    const claimedBy = dto.release === true ? null : actor.actorId;
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
      loaded.versions,
    );
    const fresh = await this.context(boardId, cardId);
    return {
      ...response,
      card: fresh.card,
      columnId: fresh.columnId,
      claimedBy: fresh.card.claimedBy ?? null,
      leaseUntil: fresh.card.leaseUntil ?? null,
      results: [response],
    };
  }

  async move(
    boardId: string,
    cardId: string,
    dto: MoveCardIntentDto,
    actor: CardIntentActor,
  ): Promise<CardMoveIntentResponse> {
    // The source column and both neighbour lists are resolved here, before
    // the command transaction, exactly like the UI's optimistic move. The
    // card version pinned below makes a concurrent move of this same card a
    // `409`; a move of another card in either column does not conflict.
    const loaded = await this.load(boardId, cardId, true);
    const card = loaded.cards[0];
    if (card === undefined) throw new NotFoundException("Card not found");
    const source = loaded.board.columns.find((column) =>
      column.cardIds.includes(cardId),
    );
    if (source === undefined || aggregateArchived(loaded.board, cardId)) {
      throw new BadRequestException("Card is archived and cannot be moved");
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
    const response = await this.apply(
      boardId,
      actor,
      dto,
      {
        type: "MOVE_CARD",
        boardId,
        at: Date.now(),
        cardId,
        fromColumnId: source.id,
        fromIndex: Math.max(0, source.cardIds.indexOf(cardId)),
        toColumnId: destination.id,
        toIndex,
      } as BoardAction,
      loaded.versions,
    );
    const fresh = await this.context(boardId, cardId);
    const currentColumn = fresh.columns.find(
      (column) => column.id === fresh.columnId,
    );
    return {
      ...response,
      card: fresh.card,
      columnId: fresh.columnId,
      fromColumnId: source.id,
      toColumnId: fresh.columnId ?? destination.id,
      toIndex: fresh.cardIndex ?? toIndex,
      columnTitle: currentColumn?.title ?? destination.title,
      results: [response],
    };
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
    const loaded = await this.load(boardId, cardId, false);
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
    const fresh = await this.context(boardId, cardId);
    return {
      ...response,
      card: fresh.card,
      columnId: fresh.columnId,
      results: [response],
    };
  }

  private async load(boardId: string, cardId: string, withIndex: boolean) {
    const loaded = await loadTargetedBoardAggregate(
      this.prisma as unknown as Prisma.TransactionClient,
      boardId,
      { cardIds: [cardId], includeCardIndex: withIndex },
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
    try {
      return await this.commands.apply(boardId, actor.actorId, command, {
        actorType: actor.actorType,
        actorRole: actor.actorRole,
        attribution: actor.attribution,
        ...(actor.principal !== undefined
          ? { principal: actor.principal }
          : {}),
        ...(actor.approvalId !== undefined
          ? { approvalId: actor.approvalId }
          : {}),
        targeted: true,
      });
    } catch (error) {
      // A WIP/workflow conflict can happen after the card version check
      // passed. It is not retryable, but the contract still says every `409`
      // on a targeted intent names the current entities; load them once on the
      // refusal path (not on the success path) and rethrow the same body.
      if (!(error instanceof ConflictException)) throw error;
      const body = error.getResponse();
      if (
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body) ||
        (body as Record<string, unknown>).versions !== undefined
      ) {
        throw error;
      }
      let versions: EntityVersions | undefined;
      try {
        versions = (await this.load(boardId, cardId, true)).versions;
      } catch {
        versions = undefined;
      }
      throw new ConflictException({
        ...(body as Record<string, unknown>),
        ...(versions !== undefined ? { versions } : {}),
      });
    }
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
