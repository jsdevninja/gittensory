import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MINER_KILL_SWITCH_ENV_VAR,
  buildMinerKillSwitchPagerDutyAlert,
  buildMinerKillSwitchTransitionGovernorLedgerEvent,
  isGlobalMinerKillSwitch,
  isMinerKillSwitchActive,
  resolveMinerKillSwitch,
} from "../dist/index.js";

test("barrel: the public entrypoint re-exports the kill-switch primitive (#2341)", () => {
  assert.equal(typeof isGlobalMinerKillSwitch, "function");
  assert.equal(typeof resolveMinerKillSwitch, "function");
  assert.equal(typeof isMinerKillSwitchActive, "function");
  assert.equal(typeof buildMinerKillSwitchTransitionGovernorLedgerEvent, "function");
  assert.equal(typeof buildMinerKillSwitchPagerDutyAlert, "function");
  assert.equal(MINER_KILL_SWITCH_ENV_VAR, "LOOPOVER_MINER_KILL_SWITCH");
});

test("isGlobalMinerKillSwitch: accepts the same truthy-string idiom as isGlobalAgentPause", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on", "On"]) {
    assert.equal(isGlobalMinerKillSwitch({ LOOPOVER_MINER_KILL_SWITCH: value }), true, `expected ${value} to be truthy`);
  }
  for (const value of [undefined, "", "0", "false", "no", "off", "banana"]) {
    assert.equal(isGlobalMinerKillSwitch({ LOOPOVER_MINER_KILL_SWITCH: value }), false, `expected ${String(value)} to be falsy`);
  }
});

test("resolveMinerKillSwitch: global denies regardless of per-repo state", () => {
  assert.equal(resolveMinerKillSwitch({ global: true, repoPaused: false }), "global");
  assert.equal(resolveMinerKillSwitch({ global: true, repoPaused: true }), "global");
  assert.equal(resolveMinerKillSwitch({ global: true, repoPaused: undefined }), "global");
});

test("resolveMinerKillSwitch: per-repo pause denies only when global is not tripped", () => {
  assert.equal(resolveMinerKillSwitch({ global: false, repoPaused: true }), "repo");
  assert.equal(resolveMinerKillSwitch({ global: false, repoPaused: false }), "none");
  assert.equal(resolveMinerKillSwitch({ global: false, repoPaused: undefined }), "none");
});

test("resolveMinerKillSwitch: toggling off resumes immediately with no residual state (pure/stateless)", () => {
  const pausedRepoA = resolveMinerKillSwitch({ global: false, repoPaused: true });
  const resumedRepoA = resolveMinerKillSwitch({ global: false, repoPaused: false });
  const stillPausedRepoB = resolveMinerKillSwitch({ global: false, repoPaused: true });
  assert.equal(pausedRepoA, "repo");
  assert.equal(resumedRepoA, "none");
  // Resuming repo A must not leak into a separate repo's independently-tracked pause state.
  assert.equal(stillPausedRepoB, "repo");
});

test("isMinerKillSwitchActive: true for any active scope, false only for none", () => {
  assert.equal(isMinerKillSwitchActive("global"), true);
  assert.equal(isMinerKillSwitchActive("repo"), true);
  assert.equal(isMinerKillSwitchActive("none"), false);
});

test("buildMinerKillSwitchTransitionGovernorLedgerEvent: no-op when the scope has not changed", () => {
  assert.equal(
    buildMinerKillSwitchTransitionGovernorLedgerEvent({
      actionClass: "open_pr",
      previousScope: "none",
      scope: "none",
    }),
    null,
  );
  assert.equal(
    buildMinerKillSwitchTransitionGovernorLedgerEvent({
      actionClass: "open_pr",
      previousScope: "global",
      scope: "global",
    }),
    null,
  );
});

test("buildMinerKillSwitchTransitionGovernorLedgerEvent: engaging the switch records a tripped kill_switch event", () => {
  const event = buildMinerKillSwitchTransitionGovernorLedgerEvent({
    repoFullName: "acme/widgets",
    actionClass: "open_pr",
    previousScope: "none",
    scope: "repo",
  });
  assert.deepEqual(event, {
    eventType: "kill_switch",
    repoFullName: "acme/widgets",
    actionClass: "open_pr",
    decision: "tripped",
    reason: "repo_kill_switch_engaged",
    payload: { previousScope: "none", scope: "repo" },
  });
});

test("buildMinerKillSwitchTransitionGovernorLedgerEvent: clearing the switch records a resumed kill_switch event", () => {
  const event = buildMinerKillSwitchTransitionGovernorLedgerEvent({
    actionClass: "open_pr",
    previousScope: "global",
    scope: "none",
  });
  assert.deepEqual(event, {
    eventType: "kill_switch",
    repoFullName: null,
    actionClass: "open_pr",
    decision: "resumed",
    reason: "global_kill_switch_cleared",
    payload: { previousScope: "global", scope: "none" },
  });
});

test("buildMinerKillSwitchPagerDutyAlert: trip builds a critical page payload (#7666)", () => {
  const alert = buildMinerKillSwitchPagerDutyAlert({
    repoFullName: "acme/widgets",
    previousScope: "none",
    scope: "repo",
  });
  assert.deepEqual(alert, {
    repoFullName: "acme/widgets",
    summary: "AMS miner kill-switch engaged (repo) for acme/widgets",
    severity: "critical",
    dedupKey: "ams_kill_switch:repo:acme/widgets",
    customDetails: { previousScope: "none", scope: "repo", reason: "repo_kill_switch_engaged" },
  });
});

test("buildMinerKillSwitchPagerDutyAlert: global trip without a repo uses ams/fleet (#7666)", () => {
  const alert = buildMinerKillSwitchPagerDutyAlert({
    previousScope: "none",
    scope: "global",
  });
  assert.equal(alert?.repoFullName, "ams/fleet");
  assert.equal(alert?.dedupKey, "ams_kill_switch:global:ams/fleet");
  assert.match(alert?.summary ?? "", /fleet-wide/);

  const blankRepo = buildMinerKillSwitchPagerDutyAlert({
    repoFullName: "   ",
    previousScope: "none",
    scope: "global",
  });
  assert.equal(blankRepo?.repoFullName, "ams/fleet");
});

test("buildMinerKillSwitchPagerDutyAlert: resume / same-scope are silent (#7666)", () => {
  assert.equal(
    buildMinerKillSwitchPagerDutyAlert({ repoFullName: "acme/widgets", previousScope: "repo", scope: "none" }),
    null,
  );
  assert.equal(
    buildMinerKillSwitchPagerDutyAlert({ repoFullName: "acme/widgets", previousScope: "repo", scope: "repo" }),
    null,
  );
});
