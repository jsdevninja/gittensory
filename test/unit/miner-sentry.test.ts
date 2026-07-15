import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureMinerError,
  flushMinerSentry,
  initMinerSentry,
  resetMinerSentryForTesting,
} from "../../packages/loopover-miner/lib/sentry.js";

afterEach(() => {
  resetMinerSentryForTesting();
  vi.restoreAllMocks();
});

describe("loopover-miner opt-in Sentry (#6011)", () => {
  it("stays fully off (never imports @sentry/node) when LOOPOVER_MINER_SENTRY_DSN is unset", async () => {
    expect(await initMinerSentry({})).toBe(false);
    // No DSN, no activation -- capture/flush must be silent no-ops, not throw for lack of a client.
    expect(() => captureMinerError(new Error("x"))).not.toThrow();
    await expect(flushMinerSentry()).resolves.toBeUndefined();
  });

  it("REGRESSION: an empty-string DSN is treated the same as unset (never activates)", async () => {
    expect(await initMinerSentry({ LOOPOVER_MINER_SENTRY_DSN: "" })).toBe(false);
  });

  it("captureMinerError never throws even when called before initMinerSentry (default off state)", () => {
    expect(() => captureMinerError("a plain string, not an Error")).not.toThrow();
    expect(() => captureMinerError(new Error("boom"), { kind: "test" })).not.toThrow();
  });

  it("resetMinerSentryForTesting returns state to the default-off no-op", async () => {
    // Without a real DSN we can't activate for real (would try to import @sentry/node against a live-looking
    // config), but we CAN prove the reset helper leaves capture/flush as no-ops either way.
    resetMinerSentryForTesting();
    expect(() => captureMinerError(new Error("x"))).not.toThrow();
    await expect(flushMinerSentry(10)).resolves.toBeUndefined();
  });

  it("defaults to process.env when no env argument is passed", async () => {
    const original = process.env.LOOPOVER_MINER_SENTRY_DSN;
    delete process.env.LOOPOVER_MINER_SENTRY_DSN;
    try {
      expect(await initMinerSentry()).toBe(false);
    } finally {
      if (original === undefined) delete process.env.LOOPOVER_MINER_SENTRY_DSN;
      else process.env.LOOPOVER_MINER_SENTRY_DSN = original;
    }
  });
});
