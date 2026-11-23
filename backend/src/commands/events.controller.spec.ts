import { parsePresence, presenceEnabledFor } from "./events.controller";

describe("SSE presence default (TASK-200.5)", () => {
  it("keeps presence on for a browser JWT and off for an agent PAT", () => {
    expect(presenceEnabledFor(undefined, "jwt")).toBe(true);
    expect(presenceEnabledFor(undefined, "pat")).toBe(false);
    expect(presenceEnabledFor(undefined, undefined)).toBe(true);
  });

  it("honours an explicit opt-in and opt-out for either principal", () => {
    expect(presenceEnabledFor("0", "jwt")).toBe(false);
    expect(presenceEnabledFor("false", "jwt")).toBe(false);
    expect(presenceEnabledFor("1", "pat")).toBe(true);
    expect(presenceEnabledFor("true", "pat")).toBe(true);
  });

  it("treats any other value as 'use the default'", () => {
    expect(parsePresence("")).toBeUndefined();
    expect(parsePresence("yes")).toBeUndefined();
    expect(presenceEnabledFor("yes", "pat")).toBe(false);
  });
});
