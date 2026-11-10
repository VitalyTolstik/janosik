import assert from "node:assert/strict";
import { test } from "node:test";

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
