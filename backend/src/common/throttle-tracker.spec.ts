import { createHash } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import { USER_JWT_AUDIENCE } from "@/auth/auth.types";
import { env } from "@/config/env";
import { principalTracker, rememberValidPat } from "./throttle-tracker";

/** B-8: throttle buckets follow the principal, not the IP. */
describe("principalTracker", () => {
  const jwt = new JwtService({ secret: env.JWT_SECRET });
  const req = (authorization?: string) => ({
    ip: "10.0.0.7",
    headers: authorization ? { authorization } : {},
  });

  it("uses the verified user id of an access token", async () => {
    const token = await jwt.signAsync(
      { sub: "user-42" },
      { audience: USER_JWT_AUDIENCE },
    );
    expect(principalTracker(req(`Bearer ${token}`))).toBe("user:user-42");
  });

  it("falls back to the IP for a forged or foreign-audience token", async () => {
    const forged = await new JwtService({ secret: "x".repeat(40) }).signAsync(
      { sub: "victim" },
      { audience: USER_JWT_AUDIENCE },
    );
    expect(principalTracker(req(`Bearer ${forged}`))).toBe("ip:10.0.0.7");
    const admin = await jwt.signAsync(
      { sub: "a1" },
      { audience: "janosik-admin" },
    );
    expect(principalTracker(req(`Bearer ${admin}`))).toBe("ip:10.0.0.7");
    expect(principalTracker(req())).toBe("ip:10.0.0.7");
  });

  it("gives only a proven PAT its own bucket", () => {
    const raw = "jnk_known-token-for-tracker-spec";
    expect(principalTracker(req(`Bearer ${raw}`))).toBe("ip:10.0.0.7");
    rememberValidPat(createHash("sha256").update(raw).digest("hex"));
    expect(principalTracker(req(`Bearer ${raw}`))).toMatch(
      /^pat:[0-9a-f]{32}$/,
    );
  });
});
