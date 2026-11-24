import assert from "node:assert/strict";
import { test } from "node:test";

import {
  API_ERROR_CODES,
  ATTENTION_NOTIFICATION_TYPES,
  USER_DATA_EXPORT_STATUSES,
} from "../shared/src/api.ts";
import { BOARD_TEMPLATE_IDS } from "../shared/src/board-templates.ts";
import {
  OpenApiLintError,
  lintSpec,
  validateOpenApi,
} from "./validate-openapi.mjs";

test("the published contract is valid OpenAPI 3.1", async () => {
  const { spec, operationIds } = await validateOpenApi();
  assert.equal(spec.openapi, "3.1.0");
  assert.ok(operationIds.length >= 40);
  assert.equal(new Set(operationIds).size, operationIds.length);
});

test("keeps CreateBoardRequest in sync with the first-run template catalog", async () => {
  const { spec } = await validateOpenApi();
  const schema = spec.components.schemas.CreateBoardRequest;
  assert.deepEqual(schema.properties.template.enum, [
    ...BOARD_TEMPLATE_IDS,
    "starter",
  ]);
  assert.match(schema.properties.templateLocale.description, /any template/i);
  assert.equal(
    schema.properties.templateDate.pattern,
    "^\\d{4}-\\d{2}-\\d{2}$",
  );
});

test("publishes the same error codes as the shared contract and describes token PATCH", async () => {
  const { spec } = await validateOpenApi();
  const { ApiErrorCode, UpdateUserTokenRequest } = spec.components.schemas;
  assert.deepEqual(ApiErrorCode.enum, [...API_ERROR_CODES]);
  assert.deepEqual(Object.keys(UpdateUserTokenRequest.properties).sort(), [
    "boardId",
    "name",
    "rateLimitPerMinute",
    "readOnly",
    "scopePreset",
    "trustedCi",
  ]);
  assert.match(UpdateUserTokenRequest.description, /`expiresAt` are stripped/);
  assert.match(
    UpdateUserTokenRequest.properties.scopePreset.description,
    /Updates the existing token's capability preset/,
  );
  const patch = spec.paths["/users/me/tokens/{tokenId}"].patch;
  assert.equal(
    patch.responses[409].content["application/json"].schema.allOf[1].properties
      .code.const,
    "token_revoked",
  );
});

test("publishes board-read backpressure as retryable with Retry-After", async () => {
  const { spec } = await validateOpenApi();
  const { ApiErrorCode } = spec.components.schemas;
  assert.ok(ApiErrorCode.enum.includes("board_read_busy"));
  assert.ok(ApiErrorCode.enum.includes("board_read_timeout"));
  assert.match(
    spec.components.headers["Retry-After"].description,
    /board_read_busy.*board_read_timeout/,
  );
  const unavailable = spec.components.responses.BoardReadUnavailable;
  assert.ok(unavailable.headers["Retry-After"]);
  assert.match(unavailable.description, /board_read_busy/);
  assert.match(unavailable.description, /board_read_timeout/);
  const getBoard = spec.paths["/boards/{boardId}"].get;
  assert.ok(getBoard.responses["304"]);
  assert.ok(getBoard.responses["503"]);
  assert.match(
    getBoard.responses["304"].headers["Cache-Control"]["$ref"],
    /PrivateNoStore/,
  );
});

test("keeps the attention type enum in sync with the shared contract", async () => {
  const { spec } = await validateOpenApi();
  const { AttentionNotification } = spec.components.schemas;
  assert.deepEqual(AttentionNotification.properties.type.enum, [
    ...ATTENTION_NOTIFICATION_TYPES,
  ]);
  assert.ok(
    AttentionNotification.properties.type.enum.includes("card.assigned"),
  );
});

test("describes ScopePreset as editable by the owner in a browser session", async () => {
  const { spec } = await validateOpenApi();
  const { ScopePreset } = spec.components.schemas;
  assert.doesNotMatch(ScopePreset.description, /\bimmutab\w*\b/i);
  assert.match(
    ScopePreset.description,
    /owner may change it in a browser session/,
  );
  assert.match(ScopePreset.description, /never raises the board role/);
  assert.match(ScopePreset.description, /readOnly: true.*effective `observer`/);
});

test("describes browser-only, PAT-only, and shared board operations", async () => {
  const { spec } = await validateOpenApi();
  const { paths } = spec;
  const sessionOnly = [{ browserSession: [] }];
  for (const operation of [
    paths["/agents/overview"].get,
    paths["/boards/{boardId}/agent-policy"].get,
    paths["/boards/{boardId}/agent-policy"].patch,
    paths["/boards/{boardId}/approvals/{approvalId}/decision"].post,
    paths["/boards/{boardId}/agents/pause"].post,
    paths["/boards/{boardId}/agents/resume"].post,
    paths["/users/me/tokens/{tokenId}"].patch,
  ]) {
    assert.deepEqual(operation.security, sessionOnly, operation.operationId);
  }
  for (const operation of [
    paths["/boards/{boardId}/approvals"].post,
    paths["/boards/{boardId}/agent-sessions"].post,
    paths["/boards/{boardId}/agent-sessions/{sessionId}/heartbeat"].post,
  ]) {
    assert.deepEqual(
      operation.security,
      [{ personalApiToken: [] }],
      operation.operationId,
    );
  }
  const revert = paths["/boards/{boardId}/runs/{runId}/revert"].post;
  assert.deepEqual(revert.security, [
    { browserSession: [] },
    { personalApiToken: [] },
  ]);
  assert.match(revert.description, /dryRun: true/);
  assert.match(revert.description, /pat_forbidden/);
  assert.match(
    revert.description,
    /PAT may call this operation only with `dryRun: true`/,
  );
  assert.match(
    revert.description,
    /`dryRun` is false or omitted, applying the revert requires a board\s+`ADMIN` browser session and a PAT receives `403 pat_forbidden`/,
  );
  assert.equal(
    paths["/boards/{boardId}/plans/apply"].post.operationId,
    "applyPlan",
  );
  assert.equal(paths["/plans/apply"], undefined);
});

test("states that relative share expiry takes precedence and absolute expiry is still validated", async () => {
  const { spec } = await validateOpenApi();
  const { expiresAt, expiresInHours } =
    spec.components.schemas.CreateShareRequest.properties;
  assert.equal(expiresAt.format, "date-time");
  assert.match(
    expiresAt.description,
    /must be ISO-8601, including when\s+expiresInHours is present/,
  );
  assert.match(expiresInHours.description, /takes precedence over expiresAt/);
});

test("publishes the public auth config and password recovery contracts", async () => {
  const { spec } = await validateOpenApi();
  const { AuthConfig } = spec.components.schemas;
  const config = spec.paths["/auth/config"].get;
  assert.deepEqual(config.security, []);
  assert.equal(
    config.responses[200].content["application/json"].schema.$ref,
    "#/components/schemas/AuthConfig",
  );
  assert.deepEqual(AuthConfig.required, [
    "allowRegistration",
    "allowPublicShares",
    "limits",
  ]);
  assert.deepEqual(AuthConfig.properties.limits.required, [
    "boards",
    "importBytes",
  ]);

  for (const [path, limit] of [
    ["/auth/password/reset/request", "3 requests per hour per IP"],
    ["/auth/password/reset/confirm", "10 requests per minute per IP"],
  ]) {
    const { security, description, responses } = spec.paths[path].post;
    assert.deepEqual(security, []);
    assert.ok(description.includes(limit));
    assert.equal(
      responses[200].content["application/json"].schema.$ref,
      "#/components/schemas/StatusOk",
    );
    assert.ok(responses[429]);
  }
});

test("keeps the account-export status enum in sync with the shared contract", async () => {
  const { spec } = await validateOpenApi();
  const { UserDataExport } = spec.components.schemas;
  assert.deepEqual(UserDataExport.properties.status.enum, [
    ...USER_DATA_EXPORT_STATUSES,
  ]);
  assert.match(UserDataExport.properties.status.description, /expired/);
  assert.match(UserDataExport.properties.status.description, /seven-day/);

  const download = spec.paths["/users/me/export/{exportId}/download"].get;
  assert.equal(download.responses[410].$ref, "#/components/responses/Gone");
  assert.match(spec.components.responses.Gone.description, /410 gone/);

  const latest = spec.paths["/users/me/export/latest"].get;
  assert.doesNotMatch(latest.summary, /unexpired/i);
  assert.match(latest.description, /status: "expired"/);
});

test("lint catches a duplicate operationId", async () => {
  const { spec } = await validateOpenApi();
  const copy = structuredClone(spec);
  const [first, second] = Object.values(copy.paths).filter(
    (pathItem) => pathItem.get,
  );
  second.get.operationId = first.get.operationId;
  const problems = lintSpec(copy);
  assert.ok(
    problems.some((problem) => problem.includes("duplicate operationId")),
  );
});

test("lint catches an unresolved local ref", async () => {
  const { spec } = await validateOpenApi();
  const copy = structuredClone(spec);
  copy.paths["/missing"] = {
    get: {
      operationId: "missingOperation",
      summary: "Missing",
      description: "Missing.",
      tags: ["Boards"],
      responses: {
        200: { $ref: "#/components/responses/DoesNotExist" },
      },
    },
  };
  const problems = lintSpec(copy);
  assert.ok(problems.some((problem) => problem.includes("unresolved $ref")));
});

test("lint catches an undeclared path parameter", async () => {
  const { spec } = await validateOpenApi();
  const copy = structuredClone(spec);
  copy.paths["/boards/{missingId}/x"] = {
    get: {
      operationId: "undeclaredPathParam",
      summary: "Undeclared",
      description: "Undeclared parameter.",
      tags: ["Boards"],
      responses: {
        200: { description: "OK" },
      },
    },
  };
  const problems = lintSpec(copy);
  assert.ok(
    problems.some((problem) =>
      problem.includes('path parameter "missingId" is not declared'),
    ),
  );
});

test("schema validation rejects a malformed document", async () => {
  await assert.rejects(
    () =>
      validateOpenApi({
        openapi: "3.1.0",
        info: { title: "Broken", version: "1" },
        paths: "not-an-object",
      }),
    (error) => error instanceof OpenApiLintError,
  );
});
