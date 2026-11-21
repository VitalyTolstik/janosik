import { ADMIN_MIME_FAMILIES } from "@janosik/shared";
import { attachmentMimeFamily } from "./mime-family";

describe("attachmentMimeFamily", () => {
  it.each([
    ["image/png", "image"],
    ["IMAGE/PNG", "image"],
    ["video/mp4", "video"],
    ["VIDEO/WEBM", "video"],
    ["application/pdf", "pdf"],
    ["APPLICATION/PDF", "pdf"],
    ["text/plain", "document"],
    ["TEXT/CSV", "document"],
    ["application/rtf", "document"],
    ["APPLICATION/RTF", "document"],
    ["application/msword", "document"],
    ["application/vnd.ms-excel", "document"],
    ["application/vnd.ms-powerpoint", "document"],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "document",
    ],
    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "document",
    ],
    ["application/json", "other"],
    ["audio/ogg", "other"],
    ["application/zip", "other"],
    ["application/octet-stream", "other"],
    ["", "other"],
  ] as const)("maps %s to %s", (mimeType, family) => {
    expect(attachmentMimeFamily(mimeType)).toBe(family);
  });

  it("maps a representative value for every admin family", () => {
    const samples = {
      image: "image/png",
      video: "video/mp4",
      pdf: "application/pdf",
      document: "text/plain",
      other: "application/json",
    } as const;
    for (const family of ADMIN_MIME_FAMILIES) {
      expect(attachmentMimeFamily(samples[family])).toBe(family);
    }
  });
});
