import {
  keepAliveProfile,
  SSE_KEEP_ALIVE_DEFAULT_MS,
  sseTiming,
} from "./sse-timing";

describe("SSE keep-alive profile (TASK-200.5)", () => {
  afterEach(() => {
    sseTiming.keepAliveMs = SSE_KEEP_ALIVE_DEFAULT_MS;
  });

  it("uses 25 s with jitter for humans and 60 s with jitter for PAT streams", () => {
    expect(keepAliveProfile(false)).toEqual({
      baseMs: 25_000,
      jitterMs: 2_500,
    });
    expect(keepAliveProfile(true)).toEqual({
      baseMs: 60_000,
      jitterMs: 6_000,
    });
  });

  it("lets a spec override apply to both streams without jitter", () => {
    sseTiming.keepAliveMs = 150;
    expect(keepAliveProfile(false)).toEqual({ baseMs: 150, jitterMs: 0 });
    expect(keepAliveProfile(true)).toEqual({ baseMs: 150, jitterMs: 0 });
  });
});
