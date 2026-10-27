import type { BoardSseEvent, CommandDeltaEntry } from "@janosik/shared";
import type { InternalCommandEvent } from "@/realtime/realtime.service";
import { CommandStreamSequencer } from "./command-stream";
import type { CommandDelta } from "./commands.service";

const entry = (seq: number): CommandDeltaEntry => ({
  seq,
  action: { type: "RENAME_BOARD", title: `t${seq}`, at: 1 } as never,
  actorId: "u1",
  commandId: `c${seq}`,
  touches: [],
});

const live = (seq: number, prevSeq?: number): InternalCommandEvent => ({
  type: "command",
  ...entry(seq),
  ...(prevSeq !== undefined ? { prevSeq } : {}),
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness(log: number[], since = 0, cap = Infinity) {
  const emitted: BoardSseEvent[] = [];
  const commands = {
    deltaSince: jest.fn(
      async (_b: string, from: number): Promise<CommandDelta> => {
        const after = log.filter((seq) => seq > from);
        if (after.length > cap) return { entries: [], resync: true };
        return { entries: after.map(entry), resync: false };
      },
    ),
    latestSeq: jest.fn(async () => (log.length ? Math.max(...log) : 0)),
  };
  const sequencer = new CommandStreamSequencer(
    commands as never,
    "b1",
    since,
    (event) => emitted.push(event),
    (error) => {
      throw error;
    },
  );
  const seqs = () =>
    emitted.map((e) => (e.type === "command" ? e.seq : e.type));
  return { sequencer, commands, emitted, seqs };
}

describe("CommandStreamSequencer (B-3/B-4)", () => {
  it("replays the delta, then contiguous live frames, with commandId and without prevSeq", async () => {
    const log = [10, 20];
    const h = harness(log, 5);
    h.sequencer.start();
    await flush();
    log.push(30);
    h.sequencer.offer(live(30, 20));
    expect(h.seqs()).toEqual([10, 20, 30]);
    const last = h.emitted[2] as unknown as Record<string, unknown>;
    expect(last.commandId).toBe("c30");
    expect(last).not.toHaveProperty("prevSeq");
  });

  it("deduplicates a frame that arrived during the catch-up", async () => {
    const log = [10, 20];
    const h = harness(log, 0);
    h.sequencer.offer(live(20, 10)); // parked: catch-up not done yet
    h.sequencer.start();
    await flush();
    expect(h.seqs()).toEqual([10, 20]);
  });

  it("re-reads the log instead of dropping a frame that overtook its predecessor", async () => {
    const log = [10];
    const h = harness(log, 10);
    h.sequencer.start();
    await flush();
    // seq 20 (prev 10) was published by another node and is late; 30 (prev
    // 20) arrives first. Both are committed, so the log has them.
    log.push(20, 30);
    h.sequencer.offer(live(30, 20));
    await flush();
    h.sequencer.offer(live(20, 10)); // the late one: already delivered
    await flush();
    expect(h.seqs()).toEqual([20, 30]);
    expect(h.commands.deltaSince).toHaveBeenLastCalledWith("b1", 10);
  });

  it("emits resync when the catch-up is truncated, then continues from the head", async () => {
    const log = [1, 2, 3, 4];
    const h = harness(log, 0, 2);
    h.sequencer.start();
    await flush();
    expect(h.seqs()).toEqual(["resync"]);
    log.push(5);
    h.sequencer.offer(live(5, 4));
    expect(h.seqs()).toEqual(["resync", 5]);
  });

  it("pulls a gap nobody announced on the heartbeat (lost publish)", async () => {
    const log = [10];
    const h = harness(log, 10);
    h.sequencer.start();
    await flush();
    log.push(11); // committed, but its frame never arrived
    await h.sequencer.verifyCaughtUp();
    await flush();
    expect(h.seqs()).toEqual([11]);
  });

  it("does not loop when the log cannot explain a predecessor", async () => {
    const log = [10, 30]; // 20 was erased with its author
    const h = harness(log, 10);
    h.sequencer.start();
    await flush();
    h.sequencer.offer(live(40, 20));
    await flush();
    await flush();
    expect(h.seqs()).toEqual([30, 40]);
  });
});
