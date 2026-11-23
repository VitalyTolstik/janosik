import {
  AGENT_COMMAND_QUEUE_MS_DEFAULT,
  AGENT_SESSION_RATE_LIMIT_MIN,
  AGENT_TOKEN_RATE_LIMIT_MIN,
  BOARD_RATE_LIMIT_MIN,
  agentCommandQueueMs,
  agentSessionRateLimit,
  agentTokenRateLimit,
  boardRateLimit,
  deriveAgentSessionRateLimit,
  deriveAgentTokenRateLimit,
  deriveBoardRateLimit,
  effectiveAgentTokenRateLimit,
  setAgentCommandQueueMs,
  setAgentSessionRateLimit,
  setAgentTokenRateLimit,
  setBoardRateLimit,
} from "./rate-limit";
import { setThrottleLimit, throttleLimit } from "./throttle";

/** TASK-200.3: swarm-sized budget derivations and their runtime overrides. */
describe("agent budget derivations", () => {
  it("keeps a high board safety ceiling at the default global limit", () => {
    expect(deriveBoardRateLimit(300, 0)).toBe(BOARD_RATE_LIMIT_MIN);
    expect(deriveBoardRateLimit(8_000, 0)).toBe(16_000);
    expect(deriveBoardRateLimit(5_000, 0)).toBe(BOARD_RATE_LIMIT_MIN);
    expect(deriveBoardRateLimit(300, 24_000)).toBe(24_000);
  });

  it("gives one session and one token a small, predictable share", () => {
    expect(deriveAgentSessionRateLimit(300, 0)).toBe(
      AGENT_SESSION_RATE_LIMIT_MIN,
    );
    expect(deriveAgentTokenRateLimit(300, 0)).toBe(AGENT_TOKEN_RATE_LIMIT_MIN);
    // A globally-raised swarm limit must not turn into one unlimited agent.
    expect(deriveAgentSessionRateLimit(12_000, 0)).toBe(12_000);
    expect(deriveAgentTokenRateLimit(12_000, 0)).toBe(3_000);
    expect(deriveBoardRateLimit(12_000, 0)).toBe(24_000);
    // A pinned positive value always wins.
    expect(deriveAgentTokenRateLimit(12_000, 900)).toBe(900);
  });

  it("caps an explicit token limit at the derived share", () => {
    // A 100k/min PAT must not outspend the swarm share when the global
    // limit is raised: the tighter budget wins.
    expect(effectiveAgentTokenRateLimit(100_000, 3_000)).toBe(3_000);
    expect(effectiveAgentTokenRateLimit(120, 600)).toBe(120);
    expect(effectiveAgentTokenRateLimit(null, 600)).toBe(600);
    expect(effectiveAgentTokenRateLimit(undefined, 600)).toBe(600);
  });
});

describe("agent budget runtime values", () => {
  const originalThrottle = throttleLimit();

  beforeEach(() => {
    setBoardRateLimit(null);
    setAgentSessionRateLimit(null);
    setAgentTokenRateLimit(null);
    setAgentCommandQueueMs(null);
  });

  afterAll(() => {
    setThrottleLimit(originalThrottle);
    setBoardRateLimit(null);
    setAgentSessionRateLimit(null);
    setAgentTokenRateLimit(null);
    setAgentCommandQueueMs(null);
  });

  it("follows the live global limit when no env override is pinned", () => {
    setThrottleLimit(300);
    expect(agentSessionRateLimit()).toBe(AGENT_SESSION_RATE_LIMIT_MIN);
    expect(agentTokenRateLimit()).toBe(AGENT_TOKEN_RATE_LIMIT_MIN);
    expect(boardRateLimit()).toBe(BOARD_RATE_LIMIT_MIN);
    expect(agentCommandQueueMs()).toBe(AGENT_COMMAND_QUEUE_MS_DEFAULT);
  });

  it("lets tests and embedders pin every value without a restart", () => {
    setThrottleLimit(300);
    setBoardRateLimit(50);
    setAgentSessionRateLimit(40);
    setAgentTokenRateLimit(30);
    setAgentCommandQueueMs(0);
    expect(boardRateLimit()).toBe(50);
    expect(agentSessionRateLimit()).toBe(40);
    expect(agentTokenRateLimit()).toBe(30);
    expect(agentCommandQueueMs()).toBe(0);
  });
});
