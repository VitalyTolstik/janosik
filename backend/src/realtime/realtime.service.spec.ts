import { RealtimeService } from "./realtime.service";

/** TASK-102: a board's channel must not outlive its last subscriber. */
describe("RealtimeService.watch", () => {
  it("releases the channel when the last watcher unsubscribes", () => {
    const realtime = new RealtimeService();
    const first = realtime.watch("b1").subscribe(() => undefined);
    const second = realtime.watch("b1").subscribe(() => undefined);
    expect(realtime.activeBoards).toBe(1);

    first.unsubscribe();
    expect(realtime.activeBoards).toBe(1);

    second.unsubscribe();
    expect(realtime.activeBoards).toBe(0);
  });

  it("does not resurrect a released channel on publish", () => {
    const realtime = new RealtimeService();
    realtime.publish("b1", { type: "presence", op: "sync", users: [] });
    expect(realtime.activeBoards).toBe(0);
  });
});
