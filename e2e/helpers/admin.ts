import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { appUrl } from "./urls.js";

/**
 * Master-panel helpers (TASK-162.15): the panel lives under the app base at
 * `/admin`, and every test gets its own master/user accounts so audit and
 * security rows stay independently identifiable.
 */

export interface MasterCredentials {
  id: string;
  email: string;
  password: string;
  role: "OWNER" | "OPERATOR";
}

export interface AdminUser {
  id: string;
  email: string;
  /** The password used when the caller supplied one (null for generated). */
  password: string | null;
}

const appBase = appUrl.replace(/\/+$/, "");

/** Absolute master-panel root, e.g. `https://host/app/admin`. */
export const adminUrl = `${appBase}/admin`;

/** Absolute URL of a panel route, e.g. `adminPath("users/1")`. */
export function adminPath(path = ""): string {
  return `${adminUrl}/${path.replace(/^\/+/, "")}`;
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@e2e.example`;
}

/** A unique label/title/filename fragment for parallel-safe data. */
export function uniqueToken(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/** The owner provisioned by `run-docker.sh` for the disposable stack. */
export function ownerCredentials(): MasterCredentials {
  return {
    id: "e2e-owner",
    email: process.env.E2E_MASTER_EMAIL ?? "master@e2e.example",
    password: process.env.E2E_MASTER_PASSWORD ?? "e2e-master-password",
    role: "OWNER",
  };
}

export async function openAdminLogin(page: Page): Promise<void> {
  await page.goto(adminUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("admin-login-form")).toBeVisible();
}

export async function submitAdminLogin(
  page: Page,
  credentials: Pick<MasterCredentials, "email" | "password">,
): Promise<void> {
  await page.getByTestId("admin-login-email").fill(credentials.email);
  await page.getByTestId("admin-login-password").fill(credentials.password);
  await page.getByTestId("admin-login-submit").click();
}

/** Sign in through the master login screen and wait for the panel shell. */
export async function loginAsMaster(
  page: Page,
  credentials: Pick<MasterCredentials, "email" | "password">,
): Promise<void> {
  await openAdminLogin(page);
  await submitAdminLogin(page, credentials);
  await expect(page.getByTestId("admin-sidebar")).toBeVisible();
}

/** A fresh regular user, created through the owner API. */
export async function createUserViaAdmin(
  admin: APIRequestContext,
  options: {
    email?: string;
    verified?: boolean;
    password?: string;
    displayName?: string;
  } = {},
): Promise<AdminUser> {
  const email = options.email ?? uniqueEmail("panel-user");
  const response = await admin.post("/api/v1/admin/users", {
    data: {
      email,
      ...(options.password === undefined ? {} : { password: options.password }),
      ...(options.displayName === undefined
        ? {}
        : { displayName: options.displayName }),
    },
  });
  expect(
    response.ok(),
    `create user: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  const body = (await response.json()) as {
    user: { id: string; email: string };
  };
  if (options.verified === true) {
    const verified = await admin.patch(`/api/v1/admin/users/${body.user.id}`, {
      data: { emailVerified: true },
    });
    expect(
      verified.ok(),
      `verify user: ${verified.status()} ${await verified.text()}`,
    ).toBeTruthy();
  }
  return {
    id: body.user.id,
    email: body.user.email,
    password: options.password ?? null,
  };
}

/**
 * Fill the generic list search and wait for its response. Without this the
 * debounced request can land after the row menu is already open, remounting
 * the list (and the menu) underneath the click.
 */
export async function searchAdminList(
  page: Page,
  entity: string,
  value: string,
): Promise<void> {
  const settled = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return (
      url.pathname.includes(`/admin/entities/${entity}`) &&
      url.searchParams.get("search") === value
    );
  });
  await page.getByRole("textbox", { name: "Search" }).fill(value);
  await settled;
}

/** A fresh master account; the temporary password is returned only here. */
export async function createMasterViaAdmin(
  admin: APIRequestContext,
  roleOrOptions:
    | "OWNER"
    | "OPERATOR"
    | {
        role?: "OWNER" | "OPERATOR";
        email?: string;
        displayName?: string;
      } = "OPERATOR",
): Promise<MasterCredentials> {
  const options =
    typeof roleOrOptions === "string" ? { role: roleOrOptions } : roleOrOptions;
  const email = options.email ?? uniqueEmail("panel-master");
  const response = await admin.post("/api/v1/admin/admins", {
    data: {
      email,
      role: options.role ?? "OPERATOR",
      ...(options.displayName === undefined
        ? {}
        : { displayName: options.displayName }),
    },
  });
  expect(
    response.ok(),
    `create master: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  const body = (await response.json()) as {
    admin: { id: string; email: string; role: "OWNER" | "OPERATOR" };
    temporaryPassword: string;
  };
  return {
    id: body.admin.id,
    email: body.admin.email,
    password: body.temporaryPassword,
    role: body.admin.role,
  };
}

export async function openRowMenu(page: Page, id: string): Promise<void> {
  await page.getByTestId(`admin-row-actions-${id}`).click();
}

/** Accept the shared confirmation dialog. */
export async function confirmAction(page: Page): Promise<void> {
  await page.getByTestId("admin-confirm-accept").click();
}

export async function expectToast(page: Page, text: string): Promise<void> {
  await expect(
    page.getByRole("status").filter({ hasText: text }).last(),
  ).toBeVisible();
}

export interface AuditExpectation {
  action: string;
  targetId?: string;
  targetType?: string;
  adminEmail?: string;
  detailsText?: string;
  timeout?: number;
}

/**
 * Assert that the audit API recorded a matching event. Browser presentation of
 * the trail is covered by `audit.spec.ts`; mutation tests use this so they do
 * not spend a page load per assertion.
 */
export async function expectAudit(
  admin: APIRequestContext,
  expectation: AuditExpectation,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const search =
          expectation.targetId ?? expectation.adminEmail ?? expectation.action;
        const response = await admin.get(
          `/api/v1/admin/audit?limit=100${
            search === "" ? "" : `&search=${encodeURIComponent(search)}`
          }`,
        );
        if (!response.ok()) return false;
        const page = (await response.json()) as {
          items: Array<{
            action: string;
            targetId: string | null;
            targetType: string | null;
            adminEmail: string;
            details: Record<string, unknown> | null;
          }>;
        };
        return page.items.some(
          (row) =>
            row.action === expectation.action &&
            (expectation.targetId === undefined ||
              row.targetId === expectation.targetId) &&
            (expectation.targetType === undefined ||
              row.targetType === expectation.targetType) &&
            (expectation.adminEmail === undefined ||
              row.adminEmail === expectation.adminEmail) &&
            (expectation.detailsText === undefined ||
              JSON.stringify(row.details ?? {}).includes(
                expectation.detailsText,
              )),
        );
      },
      { timeout: expectation.timeout ?? 10_000 },
    )
    .toBe(true);
}

/** Read the current master row through the owner API. */
export async function readMaster(
  admin: APIRequestContext,
  masterId: string,
): Promise<{
  id: string;
  email: string;
  disabledAt: number | null;
  lockedUntil: number | null;
  failedLogins: number;
}> {
  const response = await admin.get("/api/v1/admin/admins");
  expect(response.ok(), await response.text()).toBeTruthy();
  const page = (await response.json()) as {
    items: Array<{
      id: string;
      email: string;
      disabledAt: number | null;
      lockedUntil: number | null;
      failedLogins: number;
    }>;
  };
  const row = page.items.find((item) => item.id === masterId);
  expect(row, `master ${masterId}`).toBeDefined();
  return row!;
}

/** Save an allowlist through the owner API (Masters → IP access equivalent). */
export async function setMasterAllowlist(
  admin: APIRequestContext,
  masterId: string,
  value: string | null,
): Promise<void> {
  const response = await admin.put(
    `/api/v1/admin/masters/${masterId}/allowlist`,
    { data: { ipAllowlist: value } },
  );
  expect(
    response.ok(),
    `allowlist: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
}
