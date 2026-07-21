import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@loopover/engine", async () => {
  return import("../../packages/loopover-engine/src/index");
});

import { checkMinerKillSwitch, notifyMinerKillSwitchPagerDuty, recordMinerKillSwitchTransition } from "../../packages/loopover-miner/lib/governor-kill-switch.js";
import { initGovernorLedger } from "../../packages/loopover-miner/lib/governor-ledger.js";

const roots: string[] = [];
const ledgers: Array<{ close(): void }> = [];

afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("checkMinerKillSwitch (#2341)", () => {
  it("global env switch halts regardless of per-repo state", () => {
    expect(checkMinerKillSwitch({ repoPaused: false, env: { LOOPOVER_MINER_KILL_SWITCH: "true" } })).toEqual({
      scope: "global",
      active: true,
    });
    expect(checkMinerKillSwitch({ repoPaused: true, env: { LOOPOVER_MINER_KILL_SWITCH: "true" } })).toEqual({
      scope: "global",
      active: true,
    });
  });

  it("per-repo pause halts only when the global switch is not tripped", () => {
    expect(checkMinerKillSwitch({ repoPaused: true, env: {} })).toEqual({ scope: "repo", active: true });
    expect(checkMinerKillSwitch({ repoPaused: false, env: {} })).toEqual({ scope: "none", active: false });
  });

  it("defaults to reading process.env when no env override is given", () => {
    const original = process.env.LOOPOVER_MINER_KILL_SWITCH;
    try {
      process.env.LOOPOVER_MINER_KILL_SWITCH = "1";
      expect(checkMinerKillSwitch({ repoPaused: false })).toEqual({ scope: "global", active: true });
    } finally {
      if (original === undefined) delete process.env.LOOPOVER_MINER_KILL_SWITCH;
      else process.env.LOOPOVER_MINER_KILL_SWITCH = original;
    }
  });
});

describe("recordMinerKillSwitchTransition (#2341)", () => {
  it("records a tripped transition to the governor ledger and resuming records a second row", () => {
    const root = mkdtempSync(join(tmpdir(), "loopover-miner-governor-kill-switch-"));
    roots.push(root);
    const ledger = initGovernorLedger(join(root, "governor-ledger.sqlite3"));
    ledgers.push(ledger);

    const tripped = recordMinerKillSwitchTransition(
      { repoFullName: "acme/widgets", actionClass: "open_pr", previousScope: "none", scope: "repo" },
      { append: (event) => ledger.appendGovernorEvent(event) },
    );
    expect(tripped?.eventType).toBe("kill_switch");
    expect(tripped?.decision).toBe("tripped");

    const resumed = recordMinerKillSwitchTransition(
      { repoFullName: "acme/widgets", actionClass: "open_pr", previousScope: "repo", scope: "none" },
      { append: (event) => ledger.appendGovernorEvent(event) },
    );
    expect(resumed?.decision).toBe("resumed");

    const rows = ledger.readGovernorEvents({ repoFullName: "acme/widgets" });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBeLessThan(rows[1]?.id ?? 0);
  });

  it("a transition with no repoFullName supplied records a null repoFullName, not an omitted or undefined one", () => {
    const root = mkdtempSync(join(tmpdir(), "loopover-miner-governor-kill-switch-no-repo-"));
    roots.push(root);
    const ledger = initGovernorLedger(join(root, "governor-ledger.sqlite3"));
    ledgers.push(ledger);

    const tripped = recordMinerKillSwitchTransition(
      { actionClass: "open_pr", previousScope: "none", scope: "global" },
      { append: (event) => ledger.appendGovernorEvent(event) },
    );

    expect(tripped?.repoFullName).toBeNull();
    const rows = ledger.readGovernorEvents({});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.repoFullName).toBeNull();
  });

  it("is a no-op and appends nothing when the scope has not changed", () => {
    const root = mkdtempSync(join(tmpdir(), "loopover-miner-governor-kill-switch-noop-"));
    roots.push(root);
    const ledger = initGovernorLedger(join(root, "governor-ledger.sqlite3"));
    ledgers.push(ledger);
    const append = vi.fn((event: Parameters<typeof ledger.appendGovernorEvent>[0]) => ledger.appendGovernorEvent(event));

    const result = recordMinerKillSwitchTransition(
      { actionClass: "open_pr", previousScope: "none", scope: "none" },
      { append },
    );

    expect(result).toBeNull();
    expect(append).not.toHaveBeenCalled();
    expect(ledger.readGovernorEvents({})).toHaveLength(0);
  });

  it("falls back to the real governor-ledger appendGovernorEvent when no append override is supplied", async () => {
    const root = mkdtempSync(join(tmpdir(), "loopover-miner-governor-kill-switch-default-append-"));
    roots.push(root);
    const dbPath = join(root, "governor-ledger.sqlite3");
    const previousDbPath = process.env.LOOPOVER_MINER_GOVERNOR_LEDGER_DB;
    process.env.LOOPOVER_MINER_GOVERNOR_LEDGER_DB = dbPath;
    try {
      const { closeDefaultGovernorLedger } = await import("../../packages/loopover-miner/lib/governor-ledger.js");
      const tripped = recordMinerKillSwitchTransition({
        repoFullName: "acme/widgets",
        actionClass: "open_pr",
        previousScope: "none",
        scope: "repo",
      }, { notify: () => undefined });
      expect(tripped?.decision).toBe("tripped");
      closeDefaultGovernorLedger();

      // recordMinerKillSwitchTransition wrote through the module-level default appendGovernorEvent (no override
      // passed); reopening the same file after closing that default confirms the write was actually persisted.
      const reopened = initGovernorLedger(dbPath);
      ledgers.push(reopened);
      expect(reopened.readGovernorEvents({ repoFullName: "acme/widgets" })).toHaveLength(1);
    } finally {
      if (previousDbPath === undefined) delete process.env.LOOPOVER_MINER_GOVERNOR_LEDGER_DB;
      else process.env.LOOPOVER_MINER_GOVERNOR_LEDGER_DB = previousDbPath;
    }
  });

  it("pages on trip via the injectable notify hook and stays silent on resume (#7666)", () => {
    const root = mkdtempSync(join(tmpdir(), "loopover-miner-governor-kill-switch-page-"));
    roots.push(root);
    const ledger = initGovernorLedger(join(root, "governor-ledger.sqlite3"));
    ledgers.push(ledger);
    const notify = vi.fn();

    recordMinerKillSwitchTransition(
      { repoFullName: "acme/widgets", actionClass: "open_pr", previousScope: "none", scope: "repo" },
      { append: (event) => ledger.appendGovernorEvent(event), notify },
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toMatchObject({
      repoFullName: "acme/widgets",
      severity: "critical",
      dedupKey: "ams_kill_switch:repo:acme/widgets",
    });

    notify.mockClear();
    recordMinerKillSwitchTransition(
      { repoFullName: "acme/widgets", actionClass: "open_pr", previousScope: "repo", scope: "none" },
      { append: (event) => ledger.appendGovernorEvent(event), notify },
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("swallows a rejected notify promise without failing the ledger write (#7666)", async () => {
    const root = mkdtempSync(join(tmpdir(), "loopover-miner-governor-kill-switch-notify-reject-"));
    roots.push(root);
    const ledger = initGovernorLedger(join(root, "governor-ledger.sqlite3"));
    ledgers.push(ledger);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const tripped = recordMinerKillSwitchTransition(
      { repoFullName: "acme/widgets", actionClass: "open_pr", previousScope: "none", scope: "repo" },
      {
        append: (event) => ledger.appendGovernorEvent(event),
        notify: async () => {
          throw new Error("async pagerduty down");
        },
      },
    );
    expect(tripped?.decision).toBe("tripped");
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("kill_switch_pagerduty_failed"));
    });
    warn.mockRestore();
  });
});

describe("notifyMinerKillSwitchPagerDuty (#7666)", () => {
  const VALID_KEY = "a".repeat(32);

  it("no-ops when the PagerDuty flag is off", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", async (...args: unknown[]) => {
      calls.push(args);
      return new Response(null, { status: 202 });
    });
    await notifyMinerKillSwitchPagerDuty(
      {
        repoFullName: "acme/widgets",
        summary: "AMS miner kill-switch engaged (repo) for acme/widgets",
        severity: "critical",
        dedupKey: "ams_kill_switch:repo:acme/widgets",
        customDetails: { previousScope: "none", scope: "repo", reason: "repo_kill_switch_engaged" },
      },
      { LOOPOVER_ENABLE_PAGERDUTY: "0", PAGERDUTY_ROUTING_KEY: VALID_KEY },
    );
    expect(calls).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("posts Events API v2 when enabled with a valid routing key", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} });
      return new Response(null, { status: 202 });
    });
    await notifyMinerKillSwitchPagerDuty(
      {
        repoFullName: "acme/widgets",
        summary: "AMS miner kill-switch engaged (repo) for acme/widgets",
        severity: "critical",
        dedupKey: "ams_kill_switch:repo:acme/widgets",
        customDetails: { previousScope: "none", scope: "repo", reason: "repo_kill_switch_engaged" },
      },
      { LOOPOVER_ENABLE_PAGERDUTY: "1", PAGERDUTY_ROUTING_KEY: VALID_KEY },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://events.pagerduty.com/v2/enqueue");
    expect(calls[0]?.body).toMatchObject({
      routing_key: VALID_KEY,
      event_action: "trigger",
      dedup_key: "ams_kill_switch:repo:acme/widgets",
      payload: { source: "loopover-miner", severity: "critical", component: "acme/widgets" },
    });
    vi.unstubAllGlobals();
  });

  it("no-ops when the routing key is missing or invalid", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", async (...args: unknown[]) => {
      calls.push(args);
      return new Response(null, { status: 202 });
    });
    await notifyMinerKillSwitchPagerDuty(
      {
        repoFullName: "acme/widgets",
        summary: "x",
        severity: "critical",
        dedupKey: "ams_kill_switch:repo:acme/widgets",
        customDetails: { previousScope: "none", scope: "repo", reason: "repo_kill_switch_engaged" },
      },
      { LOOPOVER_ENABLE_PAGERDUTY: "1" },
    );
    await notifyMinerKillSwitchPagerDuty(
      {
        repoFullName: "acme/widgets",
        summary: "x",
        severity: "critical",
        dedupKey: "ams_kill_switch:repo:acme/widgets",
        customDetails: { previousScope: "none", scope: "repo", reason: "repo_kill_switch_engaged" },
      },
      { LOOPOVER_ENABLE_PAGERDUTY: "1", PAGERDUTY_ROUTING_KEY: "not-a-key" },
    );
    expect(calls).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("warns but does not throw when PagerDuty returns a non-ok status", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 500 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      notifyMinerKillSwitchPagerDuty(
        {
          repoFullName: "acme/widgets",
          summary: "x",
          severity: "critical",
          dedupKey: "ams_kill_switch:repo:acme/widgets",
          customDetails: { previousScope: "none", scope: "repo", reason: "repo_kill_switch_engaged" },
        },
        { LOOPOVER_ENABLE_PAGERDUTY: "yes", PAGERDUTY_ROUTING_KEY: VALID_KEY },
      ),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("kill_switch_pagerduty_failed"));
    warn.mockRestore();
    vi.unstubAllGlobals();
  });
});
