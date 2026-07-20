import { describe, expect, it } from "vitest";
import { listPrVisibilitySkipAuditEvents, recordAuditEvent } from "../../src/db/repositories";
import { createTestEnv } from "../helpers/d1";

describe("skipped PR audit repository export", () => {
  it("bounds queries, scopes repositories, and skips malformed audit targets", async () => {
    const env = createTestEnv();
    await recordAuditEvent(env, {
      eventType: "github_app.pr_visibility_skipped",
      targetKey: "owner/re_po#7",
      outcome: "completed",
      detail: null,
      createdAt: "2026-05-28T00:00:07.000Z",
    });
    await recordAuditEvent(env, {
      eventType: "github_app.pr_visibility_skipped",
      targetKey: "owner/reXpo#8",
      outcome: "completed",
      detail: "bot_author",
      createdAt: "2026-05-28T00:00:08.000Z",
    });
    await recordAuditEvent(env, {
      eventType: "github_app.pr_visibility_skipped",
      targetKey: null,
      outcome: "completed",
      detail: "missing_target",
      createdAt: "2026-05-28T00:00:09.000Z",
    });
    await recordAuditEvent(env, {
      eventType: "github_app.pr_visibility_skipped",
      targetKey: "bad-target",
      outcome: "completed",
      detail: "bad_target",
      createdAt: "2026-05-28T00:00:10.000Z",
    });
    await recordAuditEvent(env, {
      eventType: "github_app.pr_visibility_skipped",
      targetKey: "owner/re_po#0",
      outcome: "completed",
      detail: "bad_number",
      createdAt: "2026-05-28T00:00:11.000Z",
    });
    await recordAuditEvent(env, {
      eventType: "github_app.pr_visibility_skipped",
      targetKey: "owner/re_po#nan",
      outcome: "completed",
      detail: "bad_number",
      createdAt: "2026-05-28T00:00:12.000Z",
    });

    const emptyScope = await listPrVisibilitySkipAuditEvents(env, { repoFullNames: [] });
    expect(emptyScope).toMatchObject({ limit: 50, offset: 0, hasMore: false, total: 0, items: [] });

    const scoped = await listPrVisibilitySkipAuditEvents(env, {
      limit: Number.NaN,
      repoFullNames: ["owner/re_po", "OWNER/re_po"],
    });
    expect(scoped.limit).toBe(1);
    expect(scoped.offset).toBe(0);
    expect(scoped.items).toEqual([
      {
        repoFullName: "owner/re_po",
        pullNumber: 7,
        reason: "skipped",
        outcome: "completed",
        createdAt: "2026-05-28T00:00:07.000Z",
      },
    ]);

    const unscoped = await listPrVisibilitySkipAuditEvents(env);
    expect(unscoped.limit).toBe(50);
    expect(unscoped.offset).toBe(0);
    expect(unscoped.items.map((item) => item.pullNumber)).toEqual([8, 7]);
    expect(unscoped.total).toBeGreaterThanOrEqual(2);

    // #7438: offset advances into the next page instead of growing limit from the start.
    const page0 = await listPrVisibilitySkipAuditEvents(env, { limit: 1, offset: 0 });
    const page1 = await listPrVisibilitySkipAuditEvents(env, { limit: 1, offset: 1 });
    expect(page0.items).toHaveLength(1);
    expect(page0.hasMore).toBe(true);
    expect(page0.offset).toBe(0);
    expect(page1.items).toHaveLength(1);
    expect(page1.offset).toBe(1);
    expect(page1.items[0]?.pullNumber).not.toBe(page0.items[0]?.pullNumber);
    expect(page1.items[0]?.pullNumber).toBe(7);

    const pastEnd = await listPrVisibilitySkipAuditEvents(env, { limit: 10, offset: 50 });
    expect(pastEnd.items).toEqual([]);
    expect(pastEnd.hasMore).toBe(false);
    expect(pastEnd.offset).toBe(50);

    const negativeOffset = await listPrVisibilitySkipAuditEvents(env, { limit: 10, offset: -5 });
    expect(negativeOffset.offset).toBe(0);
    expect(negativeOffset.items.map((item) => item.pullNumber)).toEqual([8, 7]);
  });
});
