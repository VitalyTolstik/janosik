/**
 * Attachment tools: list a card's files, upload one from a local path,
 * download one to a local path, and delete. Blobs stream to board members
 * only; uploads respect the server's size and mime allowlist.
 *
 * Upload/download touch the machine running this server, and board content is
 * untrusted (it can reach the model as tool output), so they are **opt-in**:
 * enable with `JANOSIK_MCP_ALLOW_FS=1`, optionally confining them to a
 * directory with `JANOSIK_MCP_FS_ROOT=/path`.
 */

import path from "node:path";

import { LIMITS } from "@janosik/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { JanosikClient } from "../client.js";
import { respond, textOnly } from "../format.js";
import {
  readSandboxedFile,
  writeSandboxedFile,
  type FsOptions,
} from "../fs-policy.js";
import { renderAttachments } from "../render.js";
import { cardIdSchema, responseFormatSchema, idSchema } from "../schemas.js";
import { DESTRUCTIVE, READ, WRITE, defineTool } from "./helpers.js";

/** A tiny extension → mime map; the server re-checks the allowlist anyway. */
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".zip": "application/zip",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
};

function mimeFor(fileName: string): string {
  return (
    MIME_BY_EXT[path.extname(fileName).toLowerCase()] ??
    "application/octet-stream"
  );
}

export function registerAttachmentTools(
  server: McpServer,
  client: JanosikClient,
  options: FsOptions,
) {
  defineTool(
    server,
    "janosik_list_attachments",
    {
      title: "List card attachments",
      description: "List the files attached to a card.",
      inputSchema: {
        cardId: cardIdSchema,
        response_format: responseFormatSchema,
      },
      annotations: READ,
    },
    async ({ cardId, response_format }) => {
      const attachments = await client.listAttachments(cardId);
      return respond(
        response_format,
        { attachments },
        renderAttachments(attachments),
      );
    },
  );

  defineTool(
    server,
    "janosik_upload_attachment",
    {
      title: "Upload an attachment",
      description:
        "Upload a local file to a card. Disabled unless the operator set " +
        "JANOSIK_MCP_ALLOW_FS=1; the path is read from the machine running " +
        "this server. The server enforces its size and mime limits.",
      inputSchema: {
        cardId: cardIdSchema,
        filePath: z
          .string()
          .min(1)
          .describe(
            "Path of the file to upload (relative paths resolve against " +
              "JANOSIK_MCP_FS_ROOT when set).",
          ),
      },
      annotations: WRITE,
    },
    async ({ cardId, filePath }) => {
      const { path: resolved, data } = await readSandboxedFile(
        filePath,
        options,
        LIMITS.attachmentSize,
      );
      const fileName = path.basename(resolved);
      const attachment = await client.uploadAttachment(
        cardId,
        fileName,
        mimeFor(fileName),
        data,
      );
      return textOnly(
        `Uploaded "${fileName}" (${attachment.sizeBytes} bytes) — \`${attachment.id}\`.`,
      );
    },
  );

  defineTool(
    server,
    "janosik_download_attachment",
    {
      title: "Download an attachment",
      description:
        "Download a card's attachment to a local path on the machine running " +
        "this server. Disabled unless the operator set JANOSIK_MCP_ALLOW_FS=1. " +
        "Returns the saved path and size.",
      inputSchema: {
        attachmentId: idSchema.describe("Attachment id."),
        outputPath: z
          .string()
          .min(1)
          .describe(
            "Path of a NEW file to write (existing files are never " +
              "overwritten; relative paths resolve against " +
              "JANOSIK_MCP_FS_ROOT when set).",
          ),
      },
      // Writes a local file, so not read-only despite reading board content.
      annotations: WRITE,
    },
    async ({ attachmentId, outputPath }) => {
      const file = await client.downloadAttachment(attachmentId);
      const resolved = await writeSandboxedFile(
        outputPath,
        options,
        file.bytes,
      );
      return textOnly(
        `Saved ${file.bytes.length} bytes to ${resolved} (${file.contentType}).`,
      );
    },
  );

  defineTool(
    server,
    "janosik_delete_attachment",
    {
      title: "Delete an attachment",
      description:
        "Delete a card attachment (the uploader or a board ADMIN). Destructive.",
      inputSchema: {
        attachmentId: idSchema.describe("Attachment id."),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ attachmentId }) => {
      await client.deleteAttachment(attachmentId);
      return textOnly(`Deleted attachment ${attachmentId}.`);
    },
  );
}
