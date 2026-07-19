import { normalizeDiscoveryIndexRequest, normalizeDiscoveryIndexResponse, buildSoftClaimRequest } from "@loopover/engine";
import { fetchWithRetry } from "./http-retry.js";
import { describeCliError } from "./cli-error.js";
import { getLogger } from "./logger.js";
export const DISCOVERY_PLANE_FLAG = "LOOPOVER_MINER_DISCOVERY_PLANE";
export const DISCOVERY_INDEX_URL_FLAG = "LOOPOVER_MINER_DISCOVERY_INDEX_URL";
export const DISCOVERY_TELEMETRY_FLAG = "LOOPOVER_MINER_DISCOVERY_TELEMETRY";
const TRUTHY_ENV_VALUE = /^(1|true|yes|on)$/i;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
function isTruthyEnvValue(value) {
    return TRUTHY_ENV_VALUE.test(value.trim());
}
// Reads below use literal `env.LOOPOVER_MINER_*` property access (not the exported *_FLAG constants above,
// which exist for callers/tests to reference the exact name without a typo) because
// scripts/generate-env-reference.mjs statically greps for exactly this `env.NAME ?? "default"` shape to keep
// packages/loopover-miner/docs/env-reference.md honest -- a dynamic `env[SOME_CONST]` lookup is invisible to it.
/** Master opt-in (default off). When false, no discovery-index traffic and no telemetry may be emitted. */
export function isDiscoveryPlaneEnabled(env = process.env) {
    return isTruthyEnvValue(env.LOOPOVER_MINER_DISCOVERY_PLANE ?? "");
}
/** Second, independent opt-in (default off) for anonymized operational telemetry -- can stay off while the
 *  plane itself is queried/claimed against. */
export function isDiscoveryTelemetryEnabled(env = process.env) {
    return isTruthyEnvValue(env.LOOPOVER_MINER_DISCOVERY_TELEMETRY ?? "");
}
function resolveDiscoveryIndexUrl(env) {
    const raw = (env.LOOPOVER_MINER_DISCOVERY_INDEX_URL ?? "").trim();
    return raw ? raw.replace(/\/+$/, "") : null;
}
function authHeaders(env) {
    const secret = typeof env.LOOPOVER_MINER_DISCOVERY_SHARED_SECRET === "string" ? env.LOOPOVER_MINER_DISCOVERY_SHARED_SECRET.trim() : "";
    return secret ? { authorization: `Bearer ${secret}` } : {};
}
const EMPTY_QUERY_RESPONSE = Object.freeze({
    contractVersion: 1,
    candidates: [],
    nextCursor: null,
});
/**
 * Query the hosted discovery-index for supplementary candidates. Returns `EMPTY_QUERY_RESPONSE` (never throws)
 * when the plane is disabled, the URL is unconfigured, or the request fails for any reason -- callers can
 * always safely concatenate `.candidates` onto their own locally-discovered set with zero special-casing.
 */
export async function queryDiscoveryIndex(query, options = {}) {
    const env = options.env ?? process.env;
    if (!isDiscoveryPlaneEnabled(env))
        return EMPTY_QUERY_RESPONSE;
    const baseUrl = resolveDiscoveryIndexUrl(env);
    if (!baseUrl)
        return EMPTY_QUERY_RESPONSE;
    // fetchWithRetry's signature is deliberately untyped-permissive (`(url: unknown, init?: unknown) =>
    // Promise<Response>`) so it can wrap any fetch-shaped function; the narrower, more useful public
    // DiscoveryIndexClientOptions#fetchImpl type is cast at this one boundary rather than widened repo-wide.
    const fetchImpl = (options.fetchImpl ?? fetch);
    const { request } = normalizeDiscoveryIndexRequest(query);
    try {
        const response = await fetchWithRetry(fetchImpl, `${baseUrl}/v1/discovery-index/query`, {
            method: "POST",
            headers: { "content-type": "application/json", ...authHeaders(env) },
            body: JSON.stringify(request.query),
        }, { timeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS });
        if (!response.ok)
            return EMPTY_QUERY_RESPONSE;
        const payload = await response.json().catch(() => null);
        return normalizeDiscoveryIndexResponse(payload).response;
    }
    catch {
        return EMPTY_QUERY_RESPONSE;
    }
}
/**
 * Best-effort soft-claim submission at work-start/work-end. `claim` is the object returned by claim-ledger.js's
 * claimIssueWithinCap(...).claim (or its rowToClaim shape generally) -- passed straight into buildSoftClaimRequest
 * with no translation, per that builder's own contract. Fire-and-forget: never throws, and the caller's real
 * work (already underway once this is called) is never blocked or aborted by a plane hiccup. Returns
 * `{sent: boolean}` for callers that want to log/test the outcome without depending on it for control flow.
 */
export async function submitSoftClaim(claim, options = {}) {
    const env = options.env ?? process.env;
    if (!isDiscoveryPlaneEnabled(env))
        return { sent: false };
    const baseUrl = resolveDiscoveryIndexUrl(env);
    if (!baseUrl)
        return { sent: false };
    const request = buildSoftClaimRequest(claim);
    if (request === null)
        return { sent: false };
    // fetchWithRetry's signature is deliberately untyped-permissive (`(url: unknown, init?: unknown) =>
    // Promise<Response>`) so it can wrap any fetch-shaped function; the narrower, more useful public
    // DiscoveryIndexClientOptions#fetchImpl type is cast at this one boundary rather than widened repo-wide.
    const fetchImpl = (options.fetchImpl ?? fetch);
    try {
        const response = await fetchWithRetry(fetchImpl, `${baseUrl}/v1/discovery-index/soft-claim`, {
            method: "POST",
            headers: { "content-type": "application/json", ...authHeaders(env) },
            body: JSON.stringify(request),
        }, { timeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS });
        return { sent: response.ok };
    }
    catch (error) {
        getLogger().debug("discovery_plane_soft_claim_failed", { error: describeCliError(error) });
        return { sent: false };
    }
}
/**
 * Emit anonymized, low-cardinality operational telemetry about the plane itself (never per-issue business
 * data) -- gated separately behind LOOPOVER_MINER_DISCOVERY_TELEMETRY, per the operator guide's invariant list
 * ("low-cardinality reason buckets", mirroring orb-export.js's `reasonBucket` convention). No hosted telemetry
 * collector endpoint exists for the discovery plane yet (out of scope for #7164/#7166), so this emits a
 * structured local log line via this package's own logger -- the gate, shape, and off-by-default behavior are
 * real and tested; swapping in a real remote sink later is a logger-call change, not a design change.
 */
export function recordDiscoveryTelemetry(event, outcome, options = {}) {
    const env = options.env ?? process.env;
    if (!isDiscoveryPlaneEnabled(env) || !isDiscoveryTelemetryEnabled(env))
        return;
    getLogger().info("discovery_plane_telemetry", { event, outcome });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGlzY292ZXJ5LWluZGV4LWNsaWVudC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImRpc2NvdmVyeS1pbmRleC1jbGllbnQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBVUEsT0FBTyxFQUFFLDhCQUE4QixFQUFFLCtCQUErQixFQUFFLHFCQUFxQixFQUFFLE1BQU0sa0JBQWtCLENBQUM7QUFDMUgsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLGlCQUFpQixDQUFDO0FBQ2pELE9BQU8sRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLGdCQUFnQixDQUFDO0FBQ2xELE9BQU8sRUFBRSxTQUFTLEVBQUUsTUFBTSxhQUFhLENBQUM7QUFFeEMsTUFBTSxDQUFDLE1BQU0sb0JBQW9CLEdBQUcsZ0NBQWdDLENBQUM7QUFDckUsTUFBTSxDQUFDLE1BQU0sd0JBQXdCLEdBQUcsb0NBQW9DLENBQUM7QUFDN0UsTUFBTSxDQUFDLE1BQU0sd0JBQXdCLEdBQUcsb0NBQW9DLENBQUM7QUFvQjdFLE1BQU0sZ0JBQWdCLEdBQUcsb0JBQW9CLENBQUM7QUFDOUMsTUFBTSwwQkFBMEIsR0FBRyxNQUFNLENBQUM7QUFFMUMsU0FBUyxnQkFBZ0IsQ0FBQyxLQUFhO0lBQ3JDLE9BQU8sZ0JBQWdCLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO0FBQzdDLENBQUM7QUFFRCwyR0FBMkc7QUFDM0csb0ZBQW9GO0FBQ3BGLDZHQUE2RztBQUM3RyxpSEFBaUg7QUFFakgsMkdBQTJHO0FBQzNHLE1BQU0sVUFBVSx1QkFBdUIsQ0FBQyxNQUEwQyxPQUFPLENBQUMsR0FBRztJQUMzRixPQUFPLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyw4QkFBOEIsSUFBSSxFQUFFLENBQUMsQ0FBQztBQUNwRSxDQUFDO0FBRUQ7K0NBQytDO0FBQy9DLE1BQU0sVUFBVSwyQkFBMkIsQ0FBQyxNQUEwQyxPQUFPLENBQUMsR0FBRztJQUMvRixPQUFPLGdCQUFnQixDQUFDLEdB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