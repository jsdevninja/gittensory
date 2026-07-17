import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/routes";
import { LoopoverMcp } from "../../src/mcp/server";
import { createSessionForGitHubUser } from "../../src/auth/security";
import { insertNotificationDeliveryIfAbsent } from "../../src/db/repositories";
import { buildContributorPrOutcomes } from "../../src/signals/contributor-pr-outcomes";
import { createTestEnv } from "../helpers/d1";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const apiHeaders = (env: Env) => ({ authorization: `Bearer ${env.LOOPOVER_API_TOKEN}` });

async function seedMergedOutcome(env: Env, recipientLogin: string, pullNumber: number, dedupKey: string) {
  await insertNotificationDeliveryIfAbsent(env, {
    dedupKey,
    channel: "badge",
    recipientLogin,
    eventType: "pull_request_merged",
    repoFullName: "owner/repo",
    pullNumber,
    title: `Merged: owner/repo#${pullNumber}`,
    body: `Your pull request owner/repo#${pullNumber} merged. Merged contributions strengthen your standing on owner/repo.`,
    deeplink: `https://github.com/owner/repo/pull/${pullNumber}`,
    actorLogin: recipientLogin,
  });
}

describe("GET /v1/contributors/:login/pr-outcomes (#6747)", () => {
  it("returns post-merge outcomes for the authenticated contributor", async () => {
    const app = createApp();
    const env = createTestEnv();
    await seedMergedOutcome(env, "miner", 7, "pull_request_merged:owner/repo#7:m1");

    const response = await app.request("/v1/contributors/miner/pr-outcomes", { headers: apiHeaders(env) }, env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      login: "miner",
      count: 1,
      summary: "LoopOver post-merge outcomes for miner: 1 merged PR(s).",
      outcomes: [{ repoFullName: "owner/repo", pullNumber: 7, outcome: "merged" }],
    });
  });

  it("honors ?limit and rejects out-of-range limits", async () => {
    const app = createApp();
    const env = createTestEnv();
    await seedMergedOutcome(env, "miner", 1, "pull_request_merged:owner/repo#1:a");
    await seedMergedOutcome(env, "miner", 2, "pull_request_merged:owner/repo#2:b");
    await seedMergedOutcome(env, "miner", 3, "pull_request_merged:owner/repo#3:c");

    const limited = await app.request("/v1/contributors/miner/pr-outcomes?limit=2", { headers: apiHeaders(env) }, env);
    expect(limited.status).toBe(200);
    const limitedBody = (await limited.json()) as { count: number };
    expect(limitedBody.count).toBe(2);

    const bad = await app.request("/v1/contributors/miner/pr-outcomes?limit=0", { headers: apiHeaders(env) }, env);
    expect(bad.status).toBe(400);
    await expect(bad.json()).resolves.toMatchObject({ error: "invalid_limit" });

    const tooHigh = await app.request("/v1/contributors/miner/pr-outcomes?limit=101", { headers: apiHeaders(env) }, env);
    expect(tooHigh.status).toBe(400);

    const notInt = await app.request("/v1/contributors/miner/pr-outcomes?limit=1.5", { headers: apiHeaders(env) }, env);
    expect(notInt.status).toBe(400);
  });

  it("rejects unauthenticated callers", async () => {
    const app = createApp();
    const env = createTestEnv();
    const response = await app.request("/v1/contributors/miner/pr-outcomes", {}, env);
    expect(response.status).toBeGreaterThanOrEqual(401);
  });

  it("forbids a session from reading another login's outcomes", async () => {
    const app = createApp();
    // Session callers reach /v1/contributors/* only when ADMIN_GITHUB_LOGINS (or a path allowlist) opens the
    // coarse gate; requireContributorAccess then enforces actor === login (same as open-pr-monitor).
    const env = createTestEnv({ ADMIN_GITHUB_LOGINS: "miner" });
    const { token } = await createSessionForGitHubUser(env, { login: "miner", id: 1 });
    const response = await app.request("/v1/contributors/other/pr-outcomes", {
      headers: { authorization: `Bearer ${token}` },
    }, env);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "forbidden_contributor" });
  });

  it("matches the host MCP tool payload for the same login (mirror parity)", async () => {
    const env = createTestEnv();
    await seedMergedOutcome(env, "miner", 7, "pull_request_merged:owner/repo#7:parity");

    const viaBuilder = await buildContributorPrOutcomes(env, "miner");

    const app = createApp();
    const viaRest = await (await app.request("/v1/contributors/miner/pr-outcomes", { headers: apiHeaders(env) }, env)).json();

    const server = new LoopoverMcp(env).createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "pr-outcomes-parity", version: "0.1.0" }, { capabilities: {} });
    await client.connect(clientTransport);
    const viaMcp = await client.callTool({ name: "loopover_pr_outcome", arguments: { login: "miner" } });
    const mcpData = (viaMcp as { structuredContent?: unknown }).structuredContent;

    expect(viaRest).toEqual(viaBuilder);
    expect(mcpData).toEqual(viaBuilder);
  });
});
