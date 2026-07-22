import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/api/routes";
import { createSessionForGitHubUser } from "../../src/auth/security";
import { upsertInstallation, upsertInstallationHealth, upsertRepositoryFromGitHub } from "../../src/db/repositories";
import { createTestEnv } from "../helpers/d1";

// #7661: tenant self-service for /v1/installations* — same loadControlPanelAccessScope filter as
// /v1/app/maintainer-dashboard. Cross-tenant read/repair must 403; operators/static tokens stay fleet-wide.

function apiHeaders(env: Env): Record<string, string> {
  return { authorization: `Bearer ${env.LOOPOVER_API_TOKEN}`, "content-type": "application/json" };
}

async function sessionHeaders(env: Env, login: string, id: number): Promise<Record<string, string>> {
  const { token } = await createSessionForGitHubUser(env, { login, id });
  return { cookie: `loopover_session=${token}`, "content-type": "application/json" };
}

async function seedTenantPair(env: Env): Promise<void> {
  await upsertInstallation(env, {
    installation: {
      id: 777,
      account: { login: "repo-owner", id: 777, type: "User" },
      repository_selection: "selected",
      permissions: { metadata: "read", pull_requests: "read", issues: "write" },
      events: ["issues", "pull_request", "repository"],
    },
  });
  await upsertRepositoryFromGitHub(env, { name: "owned-repo", full_name: "repo-owner/owned-repo", private: false, default_branch: "main", owner: { login: "repo-owner" } }, 777);
  await upsertInstallationHealth(env, {
    installationId: 777,
    accountLogin: "repo-owner",
    repositorySelection: "selected",
    installedReposCount: 1,
    registeredInstalledCount: 1,
    status: "needs_attention",
    missingPermissions: ["pull_requests"],
    missingEvents: [],
    permissions: { metadata: "read", pull_requests: "read", issues: "write" },
    events: ["issues", "pull_request", "repository"],
    checkedAt: "2026-05-28T00:00:00.000Z",
    authMode: "local",
  });

  await upsertInstallation(env, {
    installation: {
      id: 888,
      account: { login: "victim-org", id: 888, type: "Organization" },
      repository_selection: "selected",
      permissions: { metadata: "read", pull_requests: "read", issues: "write" },
      events: ["issues", "pull_request", "repository"],
    },
  });
  await upsertRepositoryFromGitHub(env, { name: "secret-repo", full_name: "victim-org/secret-repo", private: true, default_branch: "main", owner: { login: "victim-org" } }, 888);
  await upsertInstallationHealth(env, {
    installationId: 888,
    accountLogin: "victim-org",
    repositorySelection: "selected",
    installedReposCount: 1,
    registeredInstalledCount: 0,
    status: "needs_attention",
    missingPermissions: ["administration"],
    missingEvents: ["issue_comment"],
    permissions: { metadata: "read" },
    events: ["issues"],
    checkedAt: "2026-05-28T00:00:00.000Z",
    authMode: "local",
    errorSummary: "victim install needs privileged recovery",
  });
}

describe("installation health/repair tenant self-service (#7661)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-28T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the static API token fleet-wide (operator-equivalent)", async () => {
    const app = createApp();
    const env = createTestEnv({ ADMIN_GITHUB_LOGINS: "jsonbored" });
    await seedTenantPair(env);

    const list = await app.request("/v1/installations", { headers: apiHeaders(env) }, env);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { installations: Array<{ id: number }>; health: Array<{ installationId: number }> };
    expect(listBody.installations.map((row) => row.id).sort()).toEqual([777, 888]);
    expect(listBody.health.map((row) => row.installationId).sort()).toEqual([777, 888]);

    expect((await app.request("/v1/installations/888/health", { headers: apiHeaders(env) }, env)).status).toBe(200);
    expect((await app.request("/v1/installations/888/repair", { headers: apiHeaders(env) }, env)).status).toBe(200);
  });

  it("scopes list/health/repair to the session tenant and forbids the other tenant", async () => {
    const app = createApp();
    const env = createTestEnv({ ADMIN_GITHUB_LOGINS: "jsonbored" });
    await seedTenantPair(env);
    const ownerHeaders = await sessionHeaders(env, "repo-owner", 777);

    const list = await app.request("/v1/installations", { headers: ownerHeaders }, env);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { installations: Array<{ id: number; accountLogin: string }>; health: Array<{ installationId: number; accountLogin: string }> };
    expect(listBody.installations).toEqual([expect.objectContaining({ id: 777, accountLogin: "repo-owner" })]);
    expect(listBody.health).toEqual([expect.objectContaining({ installationId: 777, accountLogin: "repo-owner" })]);
    expect(JSON.stringify(listBody)).not.toContain("victim-org");
    expect(JSON.stringify(listBody)).not.toContain("victim install needs privileged recovery");

    const ownHealth = await app.request("/v1/installations/777/health", { headers: ownerHeaders }, env);
    expect(ownHealth.status).toBe(200);
    await expect(ownHealth.json()).resolves.toMatchObject({ installationId: 777, accountLogin: "repo-owner" });

    const ownRepair = await app.request("/v1/installations/777/repair", { headers: ownerHeaders }, env);
    expect(ownRepair.status).toBe(200);
    await expect(ownRepair.json()).resolves.toMatchObject({
      installation: { installationId: 777 },
      refresh: { method: "POST", path: "/v1/installations/777/repair/refresh" },
    });

    for (const path of ["/v1/installations/888/health", "/v1/installations/888/repair"] as const) {
      const forbidden = await app.request(path, { headers: ownerHeaders }, env);
      expect(forbidden.status).toBe(403);
      await expect(forbidden.json()).resolves.toMatchObject({ error: "forbidden_installation" });
    }
  });

  it("REGRESSION (#7661): refresh never contacts GitHub for another tenant's installation", async () => {
    const app = createApp();
    const env = createTestEnv({ ADMIN_GITHUB_LOGINS: "jsonbored" });
    await seedTenantPair(env);
    const ownerHeaders = await sessionHeaders(env, "repo-owner", 777);

    let fetchCalls = 0;
    vi.stubGlobal("fetch", async () => {
      fetchCalls += 1;
      return new Response("should-not-run", { status: 500 });
    });

    const forbidden = await app.request("/v1/installations/888/repair/refresh", { method: "POST", headers: ownerHeaders }, env);
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({ error: "forbidden_installation" });
    expect(fetchCalls).toBe(0);
  });

  it("lets a tenant refresh their own installation after the scope gate", async () => {
    const app = createApp();
    const env = createTestEnv({ ADMIN_GITHUB_LOGINS: "jsonbored" });
    await seedTenantPair(env);
    const ownerHeaders = await sessionHeaders(env, "repo-owner", 777);

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/app/installations/777")) {
        return Response.json({
          id: 777,
          account: { login: "repo-owner", id: 777, type: "User" },
          repository_selection: "selected",
          permissions: { metadata: "read", pull_requests: "write", issues: "write" },
          events: ["issues", "issue_comment", "pull_request", "repository", "installation_repositories"],
        });
      }
      return new Response("not found", { status: 404 });
    });

    const refreshed = await app.request("/v1/installations/777/repair/refresh", { method: "POST", headers: ownerHeaders }, env);
    expect(refreshed.status).toBe(200);
    await expect(refreshed.json()).resolves.toMatchObject({
      refreshed: true,
      installation: { installationId: 777, accountLogin: "repo-owner" },
    });
  });

  it("rejects sessions without maintainer/owner/operator role before any installation lookup", async () => {
    const app = createApp();
    const env = createTestEnv({ ADMIN_GITHUB_LOGINS: "jsonbored" });
    await seedTenantPair(env);
    const strangerHeaders = await sessionHeaders(env, "new-user", 2468);

    for (const path of ["/v1/installations", "/v1/installations/777/health", "/v1/installations/777/repair"] as const) {
      const response = await app.request(path, { headers: strangerHeaders }, env);
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: "insufficient_role" });
    }

    const refresh = await app.request("/v1/installations/777/repair/refresh", { method: "POST", headers: strangerHeaders }, env);
    expect(refresh.status).toBe(403);
    await expect(refresh.json()).resolves.toMatchObject({ error: "insufficient_role" });
  });

  it("lets an operator session see the full fleet including another tenant", async () => {
    const app = createApp();
    const env = createTestEnv({ ADMIN_GITHUB_LOGINS: "fleet-op" });
    await seedTenantPair(env);
    const operatorHeaders = await sessionHeaders(env, "fleet-op", 1);

    const list = await app.request("/v1/installations", { headers: operatorHeaders }, env);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { installations: Array<{ id: number }> };
    expect(listBody.installations.map((row) => row.id).sort()).toEqual([777, 888]);

    expect((await app.request("/v1/installations/888/health", { headers: operatorHeaders }, env)).status).toBe(200);
  });

  it("returns 404 for an in-scope missing health row and 400 for a non-numeric id", async () => {
    const app = createApp();
    const env = createTestEnv({ ADMIN_GITHUB_LOGINS: "jsonbored" });
    await upsertInstallation(env, {
      installation: {
        id: 901,
        account: { login: "repo-owner", id: 777, type: "User" },
        repository_selection: "selected",
        permissions: { metadata: "read" },
        events: ["issues"],
      },
    });
    await upsertRepositoryFromGitHub(env, { name: "owned-repo", full_name: "repo-owner/owned-repo", private: false, default_branch: "main", owner: { login: "repo-owner" } }, 901);
    const ownerHeaders = await sessionHeaders(env, "repo-owner", 777);

    expect((await app.request("/v1/installations/not-a-number/health", { headers: ownerHeaders }, env)).status).toBe(400);
    expect((await app.request("/v1/installations/not-a-number/repair", { headers: ownerHeaders }, env)).status).toBe(400);
    expect((await app.request("/v1/installations/not-a-number/repair/refresh", { method: "POST", headers: ownerHeaders }, env)).status).toBe(400);

    const missingHealth = await app.request("/v1/installations/901/health", { headers: ownerHeaders }, env);
    expect(missingHealth.status).toBe(404);
    await expect(missingHealth.json()).resolves.toMatchObject({ error: "installation_health_not_found" });

    const missingRepair = await app.request("/v1/installations/901/repair", { headers: ownerHeaders }, env);
    expect(missingRepair.status).toBe(404);

    const missingRefresh = await app.request("/v1/installations/9999/repair/refresh", { method: "POST", headers: ownerHeaders }, env);
    expect(missingRefresh.status).toBe(404);
    await expect(missingRefresh.json()).resolves.toMatchObject({ error: "installation_not_found" });
  });

  it("allows access when only installation health carries the scoped account login", async () => {
    const app = createApp();
    const env = createTestEnv({ ADMIN_GITHUB_LOGINS: "jsonbored" });
    // Health row alone (no installations row) still scopes via accountLogin — mirrors dashboard OR filter.
    await upsertInstallationHealth(env, {
      installationId: 555,
      accountLogin: "repo-owner",
      repositorySelection: "selected",
      installedReposCount: 0,
      registeredInstalledCount: 0,
      status: "healthy",
      missingPermissions: [],
      missingEvents: [],
      permissions: { metadata: "read" },
      events: ["issues"],
      checkedAt: "2026-05-28T00:00:00.000Z",
      authMode: "local",
    });
    await upsertInstallation(env, {
      installation: {
        id: 556,
        account: { login: "repo-owner", id: 777, type: "User" },
        repository_selection: "selected",
        permissions: { metadata: "read" },
        events: ["issues"],
      },
    });
    await upsertRepositoryFromGitHub(env, { name: "owned-repo", full_name: "repo-owner/owned-repo", private: false, default_branch: "main", owner: { login: "repo-owner" } }, 556);
    const ownerHeaders = await sessionHeaders(env, "repo-owner", 777);

    const health = await app.request("/v1/installations/555/health", { headers: ownerHeaders }, env);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ installationId: 555, accountLogin: "repo-owner" });

    const list = await app.request("/v1/installations", { headers: ownerHeaders }, env);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { health: Array<{ installationId: number }> };
    expect(listBody.health.some((row) => row.installationId === 555)).toBe(true);
  });

  it("leaks no wallet/hotkey/trust-score terms on tenant-scoped responses", async () => {
    const app = createApp();
    const env = createTestEnv({ ADMIN_GITHUB_LOGINS: "jsonbored" });
    await seedTenantPair(env);
    const ownerHeaders = await sessionHeaders(env, "repo-owner", 777);
    const response = await app.request("/v1/installations/777/repair", { headers: ownerHeaders }, env);
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toMatch(/wallet|hotkey|raw trust score|payout|reward estimate|farming|private reviewability|public score estimate/i);
  });
});
