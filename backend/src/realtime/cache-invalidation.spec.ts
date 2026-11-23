import type { BoardSseEvent } from "@janosik/shared";
import {
  CACHE_INVALIDATION_VERSION,
  RealtimeService,
} from "./realtime.service";

/**
 * The realtime control channel (TASK-200.5): local delivery is synchronous
 * even without Redis, board membership frames double as invalidation, and a
 * remote frame with an unknown version is ignored instead of mis-applied.
 */
describe("Realtime cache invalidation (TASK-200.5)", () => {
  function bus(): RealtimeService {
    // No onModuleInit: no Redis connection and no monitor timer in unit tests.
    return new RealtimeService();
  }

  it("delivers an invalidation to local listeners and supports unsubscribe", () => {
    const service = bus();
    const first = jest.fn();
    const second = jest.fn();
    const offFirst = service.onInvalidation(first);
    service.onInvalidation(second);

    service.publishInvalidation({ kind: "flags", key: "realtime_sse" });
    expect(first).toHaveBeenCalledWith({
      kind: "flags",
      key: "realtime_sse",
    });
    expect(second).toHaveBeenCalledTimes(1);

    offFirst();
    service.publishInvalidation({ kind: "pat", tokenId: "token-1" });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("derives membership invalidation from an existing board frame", () => {
    const service = bus();
    const listener = jest.fn();
    service.onInvalidation(listener);
    const event: BoardSseEvent = {
      type: "membership",
      boardId: "board-1",
      userId: "user-1",
      change: "removed",
    };

    service.publish("board-1", event);

    expect(listener).toHaveBeenCalledWith({
      kind: "membership",
      boardId: "board-1",
      userId: "user-1",
    });
  });

  it("applies a versioned remote control frame and ignores unknown versions", () => {
    const service = bus();
    const listener = jest.fn();
    service.onInvalidation(listener);
    const receive = (
      service as unknown as { receiveInvalidation: (payload: string) => void }
    ).receiveInvalidation.bind(service);

    receive(
      JSON.stringify({
        v: CACHE_INVALIDATION_VERSION + 1,
        origin: "other-node",
        event: { kind: "pat" },
      }),
    );
    expect(listener).not.toHaveBeenCalled();

    receive(
      JSON.stringify({
        v: CACHE_INVALIDATION_VERSION,
        origin: "other-node",
        event: { kind: "membership", boardId: "board-1", userId: "user-1" },
      }),
    );
    expect(listener).toHaveBeenCalledWith({
      kind: "membership",
      boardId: "board-1",
      userId: "user-1",
    });
  });
});
