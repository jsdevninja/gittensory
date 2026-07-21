import { type MinerKillSwitchPagerDutyAlert } from "@loopover/engine";
import type { MinerKillSwitchScope } from "@loopover/engine";
import type { AppendGovernorEventInput, GovernorLedgerEntry } from "./governor-ledger.js";
export type CheckMinerKillSwitchInput = {
    repoPaused?: boolean;
    env?: Record<string, string | undefined>;
};
export type CheckMinerKillSwitchResult = {
    scope: MinerKillSwitchScope;
    active: boolean;
};
/**
 * Resolve the current kill-switch scope for a repo from process env plus a per-repo paused flag (typically
 * `MinerGoalSpec.killSwitch.paused` from the repo's parsed `.loopover-miner.yml`).
 */
export declare function checkMinerKillSwitch(input?: CheckMinerKillSwitchInput): CheckMinerKillSwitchResult;
export type RecordMinerKillSwitchTransitionInput = {
    repoFullName?: string;
    actionClass: string;
    previousScope: MinerKillSwitchScope;
    scope: MinerKillSwitchScope;
};
export type NotifyMinerKillSwitchTrip = (alert: MinerKillSwitchPagerDutyAlert, env: Record<string, string | undefined>) => void | Promise<void>;
/**
 * Miner-side mirror of `triggerPagerDutyIncident` (#7666): same flag, same global routing key, same Events
 * API v2 enqueue. No D1 audit/cooldown (miner has no Worker Env) -- PagerDuty's own `dedup_key` still
 * coalesces duplicate incidents. Best-effort: never throws.
 */
export declare function notifyMinerKillSwitchPagerDuty(alert: MinerKillSwitchPagerDutyAlert, env?: Record<string, string | undefined>): Promise<void>;
/**
 * Record a kill-switch state transition to the governor ledger. No-op (returns null, appends nothing) when the
 * scope has not actually changed since the previous check -- callers own tracking the previous scope (in-memory
 * or persisted); this module holds no state of its own. On a trip, also fires the PagerDuty page (#7666)
 * unless `notify` is overridden (tests) or the integration flag/key is unset.
 */
export declare function recordMinerKillSwitchTransition(input: RecordMinerKillSwitchTransitionInput, options?: {
    append?: (event: AppendGovernorEventInput) => GovernorLedgerEntry;
    notify?: NotifyMinerKillSwitchTrip;
    env?: Record<string, string | undefined>;
}): GovernorLedgerEntry | null;
