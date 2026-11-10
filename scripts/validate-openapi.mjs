#!/usr/bin/env node
/**
 * Validate the published OpenAPI contract.
 *
 * The OpenAPI 3.1 structure itself is checked by
 * `@seriousme/openapi-schema-validator` (the official 3.1 JSON schema). On
 * top of that this script enforces the invariants that matter for the docs:
 * unique operation ids and paths, declared path parameters, resolvable local
 * refs, known tags/security schemes, and a description/summary on every
 * operation. It is deliberately dependency-light so CI can run it before the
 * site build.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Validator } from "@seriousme/openapi-schema-validator";

const DEFAULT_SPEC = new URL("../site/public/openapi.yaml", import.meta.url);

export class OpenApiLintError extends Error {
  /**
   * @param {string[]} problems
   */
  constructor(problems) {
    super(problems.join("\n"));
    this.name = "OpenApiLintError";
    this.problems = problems;
  }
}

/** Resolve one local JSON pointer. */
function resolvePointer(document, ref) {
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  let cursor = document;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    if (!Object.hasOwn(cursor, part)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

/** Collect every `$ref` string in the document. */
function collectRefs(value, refs = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
    return refs;
  }
  if (value === null || typeof value !== "object") return refs;
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string") refs.push(child);
    else collectRefs(child, refs);
  }
  return refs;
}

/** Replace path parameter names so `/a/{x}` and `/a/{y}` collide. */
function normalizedPath(path) {
  return path.replace(/\{[^}]+\}/g, "{}");
}

/** Resolve a parameter that may be a local `$ref`. */
function dereference(document, value) {
  if (value && typeof value === "object" && typeof value.$ref === "string") {
    return resolvePointer(document, value.$ref);
  }
  return value;
}

/**
 * Lint a parsed OpenAPI document in addition to the schema validation.
 * @param {Record<string, any>} spec
 * @returns {string[]}
 */
export function lintSpec(spec) {
  const problems = [];
  const add = (message) => problems.push(message);

  if (typeof spec.openapi !== "string" || !/^3\.1\.\d+$/.test(spec.openapi)) {
    add(`openapi must be a 3.1.x version, got ${String(spec.openapi)}`);
  }
  if (!spec.info || typeof spec.info !== "object") {
    add("info is required");
  } else {
    if (typeof spec.info.title !== "string" || spec.info.title === "") {
      add("info.title is required");
    }
    if (typeof spec.info.version !== "string" || spec.info.version === "") {
      add("info.version is required");
    }
    if (
      typeof spec.info.description !== "string" ||
      spec.info.description === ""
    ) {
      add("info.description must state the document scope");
    }
  }
  if (!Array.isArray(spec.servers) || spec.servers.length === 0) {
    add("servers must contain at least the base URL");
  }
  if (spec.security !== undefined) {
    if (!Array.isArray(spec.security)) add("security must be an array");
    else {
      for (const requirement of spec.security) {
        for (const name of Object.keys(requirement ?? {})) {
          if (!spec.components?.securitySchemes?.[name]) {
            add(`security requirement names undefined scheme "${name}"`);
          }
        }
      }
    }
  }

  const tags = new Set(
    Array.isArray(spec.tags)
      ? spec.tags.map((tag) => tag?.name).filter(Boolean)
      : [],
  );
  const operationIds = new Map();
  const normalizedPaths = new Map();
  const paths = spec.paths;
  if (!paths || typeof paths !== "object") {
    add("paths is required");
    return problems;
  }

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!path.startsWith("/")) add(`path "${path}" must start with "/"`);
    const normalized = normalizedPath(path);
    if (normalizedPaths.has(normalized)) {
      add(
        `paths "${normalizedPaths.get(normalized)}" and "${path}" have the same template`,
      );
    } else {
      normalizedPaths.set(normalized, path);
    }
    if (!pathItem || typeof pathItem !== "object") {
      add(`path "${path}" has no path item`);
      continue;
    }

    const pathParameters = (pathItem.parameters ?? [])
      .map((parameter) => dereference(spec, parameter))
      .filter(Boolean);
    const templateNames = [...path.matchAll(/\{([^}]+)\}/g)].map(
      (match) => match[1],
    );

    for (const method of [
      "get",
      "put",
      "post",
      "delete",
      "options",
      "head",
      "patch",
      "trace",
    ]) {
      const operation = pathItem[method];
      if (!operation) continue;
      const where = `${method.toUpperCase()} ${path}`;
      if (
        typeof operation.operationId !== "string" ||
        operation.operationId === ""
      ) {
        add(`${where}: operationId is required`);
      } else if (operationIds.has(operation.operationId)) {
        add(
          `${where}: duplicate operationId "${operation.operationId}" (also ${operationIds.get(operation.operationId)})`,
        );
      } else {
        operationIds.set(operation.operationId, where);
      }
      if (!/^[a-z][A-Za-z0-9]+$/.test(operation.operationId ?? "")) {
        add(`${where}: operationId must be camelCase`);
      }
      if (typeof operation.summary !== "string" || operation.summary === "") {
        add(`${where}: summary is required`);
      }
      if (
        typeof operation.description !== "string" ||
        operation.description === ""
      ) {
        add(`${where}: description is required`);
      }
      if (!Array.isArray(operation.tags) || operation.tags.length === 0) {
        add(`${where}: at least one tag is required`);
      } else {
        for (const tag of operation.tags) {
          if (!tags.has(tag)) add(`${where}: undefined tag "${tag}"`);
        }
      }

      const operationParameters = (operation.parameters ?? [])
        .map((parameter) => dereference(spec, parameter))
        .filter(Boolean);
      const parameters = [...pathParameters, ...operationParameters];
      const parameterKeys = new Set();
      for (const parameter of parameters) {
        const key = `${parameter.in}:${parameter.name}`;
        if (parameterKeys.has(key)) add(`${where}: duplicate parameter ${key}`);
        parameterKeys.add(key);
        for (const name of templateNames) {
          if (
            parameter.in === "path" &&
            parameter.name === name &&
            parameter.required !== true
          ) {
            add(`${where}: path parameter "${name}" must be required`);
          }
        }
      }
      for (const name of templateNames) {
        if (!parameterKeys.has(`path:${name}`)) {
          add(`${where}: path parameter "${name}" is not declared`);
        }
      }
      for (const parameter of parameters) {
        if (
          parameter.in === "path" &&
          !templateNames.includes(parameter.name)
        ) {
          add(
            `${where}: path parameter "${parameter.name}" is not in the path`,
          );
        }
      }

      if (!operation.responses || typeof operation.responses !== "object") {
        add(`${where}: responses are required`);
      } else {
        const statuses = Object.keys(operation.responses);
        if (statuses.length === 0) add(`${where}: responses are empty`);
        for (const status of statuses) {
          if (status !== "default" && !/^[1-5][0-9]{2}$/.test(status)) {
            add(`${where}: invalid response status "${status}"`);
          }
          const response = dereference(spec, operation.responses[status]);
          if (!response || typeof response !== "object") {
            add(`${where}: response ${status} is not an object`);
          } else if (
            typeof response.description !== "string" ||
            response.description === ""
          ) {
            add(`${where}: response ${status} has no description`);
          }
        }
        if (
          !statuses.some((status) => status.startsWith("2")) &&
          !statuses.includes("default")
        ) {
          add(`${where}: no success response`);
        }
      }
    }
  }

  for (const ref of collectRefs(spec)) {
    if (!ref.startsWith("#/")) {
      add(`external $ref is not allowed: ${ref}`);
      continue;
    }
    if (resolvePointer(spec, ref) === undefined) {
      add(`unresolved $ref: ${ref}`);
    }
  }

  return problems;
}

/**
 * Validate and lint a document.
 * @param {string | Record<string, any>} source A file path, YAML text, or parsed object.
 * @returns {Promise<{ spec: Record<string, any>, operationIds: string[], problems: string[] }>}
 */
export async function validateOpenApi(source = fileURLToPath(DEFAULT_SPEC)) {
  const validator = new Validator();
  const result = await validator.validate(source);
  if (!result.valid) {
    throw new OpenApiLintError([
      `OpenAPI ${validator.version || "?"} schema validation failed`,
      ...(Array.isArray(result.errors)
        ? result.errors.map(
            (error) =>
              `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
          )
        : [String(result.errors ?? "unknown schema error")]),
    ]);
  }

  const spec = /** @type {Record<string, any>} */ (validator.specification);
  const problems = lintSpec(spec);
  if (problems.length > 0) throw new OpenApiLintError(problems);

  const operationIds = [];
  for (const pathItem of Object.values(spec.paths ?? {})) {
    for (const method of [
      "get",
      "put",
      "post",
      "delete",
      "options",
      "head",
      "patch",
      "trace",
    ]) {
      const operation = pathItem?.[method];
      if (operation?.operationId) operationIds.push(operation.operationId);
    }
  }
  return { spec, operationIds, problems: [] };
}

async function main() {
  const specPath = process.argv[2] ?? fileURLToPath(DEFAULT_SPEC);
  const { operationIds } = await validateOpenApi(specPath);
  console.log(
    `OpenAPI 3.1 valid: ${operationIds.length} operations, ${readFileSync(specPath, "utf8").split("\n").length} lines — ${specPath}`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    if (error instanceof OpenApiLintError) {
      console.error(
        `OpenAPI validation failed:\n- ${error.problems.join("\n- ")}`,
      );
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });
}
