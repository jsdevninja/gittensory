/** Opt-in client for the hosted discovery-index service (#4250, #7164/#7166/#7168). Complete no-op unless
 * LOOPOVER_MINER_DISCOVERY_PLANE is set -- mirrors sentry.js's own-project opt-in posture: nothing here is ever
 * auto-enabled or phones home by default. Supplements (never replaces) opportunity-fanout.js's per-instance
 * GitHub fan-out with results from the shared, centrally-cached index, and submits soft-claim coordination at
 * work-start/work-end -- the fleet-wide rate-limit mitigation packages/loopover-miner/docs/discovery-plane-
 * operator-guide.md documents. Every call here is fail-open (never throws, degrades to "no supplement"/"no
 * telemetry sent" on any error), matching orb-export.js's sendAmsExportBatch: an optional-plane hiccup must
 * never break the miner's real discover/attempt work. Uses @loopover/engine's discovery-index-contract.ts and
 * discovery-soft-claim.ts exports directly rather than re-implementing the shapes. */
import type { DiscoveryIndexQuery, DiscoveryIndexResponse } from "@loopover/engine";
export declare const DISCOVERY_PLANE_FLAG = "LOOPOVER_MINER_DISCOVERY_PLANE";
export declare const DISCOVERY_INDEX_URL_FLAG = "LOOPOVER_MINER_DISCOVERY_INDEX_URL";
export declare const DISCOVERY_TELEMETRY_FLAG = "LOOPOVER_MINER_DISCOVERY_TELEMETRY";
export type DiscoveryIndexClientOptions = {
    env?: Record<string, string | undefined>;
    /** Always called as `fetchImpl(url, init)` with a plain string URL -- narrower than `typeof fetch` on
     *  purpose, since that's the only shape this module ever actually calls it with. */
    fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
    requestTimeoutMs?: number;
};
/** The shape claim-ledger.js's rowToClaim (and claimIssueWithinCap(...).claim) already produces -- passed
 *  straight into @loopover/engine's buildSoftClaimRequest with no translation. */
export type SoftClaimLedgerRecord = {
    repoFullName: string;
    issueNumber: number;
    claimedAt: string;
    status: "active" | "released" | "expired";
    note?: string | null;
};
/** Master opt-in (default off). When false, no discovery-index traffic and no telemetry may be emitted. */
export declare function isDiscoveryPlaneEnabled(env?: Record<string, string | undefined>): boolean;
/** Second, independent opt-in (default off) for anonymized operational telemetry -- can stay off while the
 *  plane itself is queried/claimed against. */
export declare function isDiscoveryTelemetryEnabled(env?: Record<string, string | undefined>): boolean;
/**
 * Query the hosted discovery-index for supplementary candidates. Returns `EMPTY_QUERY_RESPONSE` (never throws)
 * when the plane is disabled, the URL is unconfigured, or the request fails for any reason -- callers can
 * always safely concatenate `.candidates` onto their own locally-discovered set with zero special-casing.
 */
export declare function queryDiscoveryIndex(query: Partial<DiscoveryIndexQuery>, options?: DiscoveryIndexClientOptions): Promise<DiscoveryIndexResponse>;
/**
 * Best-effort soft-claim submission at work-start/work-end. `claim` is the object returned by claim-ledger.js's
 * claimIssueWithinCap(...).claim (or its rowToClaim shape generally) -- passed straight into buildSoftClaimRequest
 * with no translation, per that builder's own contract. Fire-and-forget: never throws, and the caller's real
 * work (already underway once this is called) is never blocked or aborted by a plane hiccup. Returns
 * `{sent: boolean}` for callers that want to log/test the outcome without depending on it for control flow.
 */
export declare function submitSoftClaim(claim: SoftClaimLedgerRecord, options?: DiscoveryIndexClientOptions): Promise<{
    sent: boolean;
}>;
/**
 * Emit anonymized, low-cardinality operational telemetry about the plane itself (never per-issue business
 * data) -- gated separately behind LOOPOVER_MINER_DISCOVERY_TELEMETRY, per the operator guide's invariant list
 * ("low-cardinality reason buckets", mirroring orb-export.js's `reasonBucket` convention). No hosted telemetry
 * collector endpoint exists for the discovery plane yet (out of scope for #7164/#7166), so this emits a
 * structured local log line via this package's own logger -- the gate, shape, and off-by-default behavior are
 * real and tested; swapping in a real remote sink later is a logger-call change, not a design change.
 */
export declare function recordDiscoveryTelemetry(event: string, outcome: string, options?: {
    env?: Record<string, string | undefined>;
}): void;
