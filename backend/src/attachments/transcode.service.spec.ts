import { buildTranscodeArgs } from "./transcode.service";

/**
 * The TASK-50 encode profile: ≤1080p x264 CRF 25 + faststart — the actual
 * ffmpeg invocation is exercised end-to-end in `attachments-transcode.e2e-spec`.
 */
describe("buildTranscodeArgs", () => {
  it("scales, encodes x264/aac and faststarts the output", () => {
    const args = buildTranscodeArgs("/data/in.mov", "/data/.tmp-x.mp4");
    const has = (flag: string) => args.includes(flag);

    expect(args[0]).toBe("-y");
    expect(args[args.indexOf("-i") + 1]).toBe("/data/in.mov");
    expect(args[args.length - 1]).toBe("/data/.tmp-x.mp4");
    expect(has("-movflags") && has("+faststart")).toBe(true);
    expect(args[args.indexOf("-crf") + 1]).toBe("25");
    expect(args[args.indexOf("-preset") + 1]).toBe("medium");
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264");
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac");
    expect(args[args.indexOf("-vf") + 1]).toContain("min(1920,iw)");
  });
});
