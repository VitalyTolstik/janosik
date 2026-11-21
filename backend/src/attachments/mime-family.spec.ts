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
});
