import assert from "node:assert/strict";
import { test } from "node:test";

import { API_ERROR_CODES } from "../shared/src/api.ts";
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
  const patch = spec.paths["/users/me/tokens/{tokenId}"].patch;
  assert.equal(
    patch.responses[409].content["application/json"].schema.allOf[1].properties
      .code.const,
    "token_revoked",
  );
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
  assert.deepEqual(revert.security ?? spec.security, [
    { browserSession: [] },
    { personalApiToken: [] },
  ]);
  assert.match(revert.description, /dryRun: true/);
  assert.match(revert.description, /pat_forbidden/);
  assert.equal(
    paths["/boards/{boardId}/plans/apply"].post.operationId,
    "applyPlan",
  );
  assert.equal(paths["/plans/apply"], undefined);
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
