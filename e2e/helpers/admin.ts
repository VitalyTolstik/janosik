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
  options: { email?: string; verified?: boolean } = {},
): Promise<AdminUser> {
  const email = options.email ?? uniqueEmail("panel-user");
  const response = await admin.post("/api/v1/admin/users", { data: { email } });
  expect(
    response.ok(),
    `create user: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  const body = (await response.json()) as { user: AdminUser };
  if (options.verified === true) {
    const verified = await admin.patch(`/api/v1/admin/users/${body.user.id}`, {
      data: { emailVerified: true },
    });
    expect(
      verified.ok(),
      `verify user: ${verified.status()} ${await verified.text()}`,
    ).toBeTruthy();
  }
  return body.user;
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
  role: "OWNER" | "OPERATOR" = "OPERATOR",
): Promise<MasterCredentials> {
  const email = uniqueEmail("panel-master");
  const response = await admin.post("/api/v1/admin/admins", {
    data: { email, role },
  });
  expect(
    response.ok(),
    `create master: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  const body = (await response.json()) as {
    admin: AdminUser & { role: "OWNER" | "OPERATOR" };
    temporaryPassword: string;
  };
  return {
    id: body.admin.id,
    email: body.admin.email,
    password: body.temporaryPassword,
    role: body.admin.role,
  };
}
