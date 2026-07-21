// Governor kill-switch gate (#2341). Resolves whether miner write activity is currently halted (globally, via
// env, or for one repo, via its .loopover-miner.yml MinerGoalSpec) and records STATE TRANSITIONS to the
// append-only governor ledger. Every-check allow/deny recording for a real write action is the fail-closed
// Governor chokepoint's job (#2340), which consults this module first in its "safest wins" precedence.
//
// #7666: a TRIP also pages via the same PagerDuty Events API v2 path ORB uses (`src/services/notify-pagerduty.ts`
// / LOOPOVER_ENABLE_PAGERDUTY + PAGERDUTY_ROUTING_KEY), so a kill-switch engage is not ledger-only. Resume
// stays silent -- clearing a halt must not wake anyone. The page is best-effort and never throws: a paging
// failure must never block the ledger write or the mid-attempt abandon that depends on it.
import { buildMinerKillSwitchPagerDutyAlert, buildMinerKillSwitchTransitionGovernorLedgerEvent, isGlobalMinerKillSwitch, isMinerKillSwitchActive, resolveMinerKillSwitch, } from "@loopover/engine";
import { appendGovernorEvent } from "./governor-ledger.js";
/**
 * Resolve the current kill-switch scope for a repo from process env plus a per-repo paused flag (typically
 * `MinerGoalSpec.killSwitch.paused` from the repo's parsed `.loopover-miner.yml`).
 */
export function checkMinerKillSwitch(input = {}) {
    const env = input.env ?? process.env;
    const global = isGlobalMinerKillSwitch(env);
    const scope = resolveMinerKillSwitch({ global, repoPaused: input.repoPaused });
    return { scope, active: isMinerKillSwitchActive(scope) };
}
const PAGERDUTY_EVENTS_URL = "https://events.pagerduty.com/v2/enqueue";
const ROUTING_KEY_RE = /^[a-f0-9]{32}$/i;
const TRUTHY_ENV = /^(1|true|yes|on)$/i;
function envString(env, name) {
    const value = env[name];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
/**
 * Miner-side mirror of `triggerPagerDutyIncident` (#7666): same flag, same global routing key, same Events
 * API v2 enqueue. No D1 audit/cooldown (miner has no Worker Env) -- PagerDuty's own `dedup_key` still
 * coalesces duplicate incidents. Best-effort: never throws.
 */
export async function notifyMinerKillSwitchPagerDuty(alert, env = process.env) {
    if (!TRUTHY_ENV.test((env.LOOPOVER_ENABLE_PAGERDUTY ?? "").trim()))
        return;
    const routingKey = envString(env, "PAGERDUTY_ROUTING_KEY");
    if (!routingKey || !ROUTING_KEY_RE.test(routingKey))
        return;
    try {
        const response = await fetch(PAGERDUTY_EVENTS_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                routing_key: routingKey,
                event_action: "trigger",
                dedup_key: alert.dedupKey,
                payload: {
                    summary: alert.summary.slice(0, 1024),
                    source: "loopover-miner",
                    severity: alert.severity,
                    timestamp: new Date().toISOString(),
                    component: alert.repoFullName,
                    custom_details: alert.customDetails,
                },
            }),
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
            console.warn(JSON.stringify({
                event: "kill_switch_pagerduty_failed",
                repo: alert.repoFullName,
                status: response.status,
            }));
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(JSON.stringify({
            event: "kill_switch_pagerduty_failed",
            repo: alert.repoFullName,
            message: message.slice(0, 200),
        }));
    }
}
/**
 * Record a kill-switch state transition to the governor ledger. No-op (returns null, appends nothing) when the
 * scope has not actually changed since the previous check -- callers own tracking the previous scope (in-memory
 * or persisted); this module holds no state of its own. On a trip, also fires the PagerDuty page (#7666)
 * unless `notify` is overridden (tests) or the integration flag/key is unset.
 */
export function recordMinerKillSwitchTransition(input, options = {}) {
    const event = buildMinerKillSwitchTransitionGovernorLedgerEvent(input);
    if (!event)
        return null;
    const append = options.append ?? appendGovernorEvent;
    const recorded = append(event);
    const alert = buildMinerKillSwitchPagerDutyAlert({
        repoFullName: input.repoFullName,
        previousScope: input.previousScope,
        scope: input.scope,
    });
    if (alert) {
        const notify = options.notify ?? notifyMinerKillSwitchPagerDuty;
        const env = options.env ?? process.env;
        try {
            const maybePromise = notify(alert, env);
            if (maybePromise != null && typeof maybePromise.then === "function") {
                void maybePromise.catch((error) => {
                    const message = error instanceof Error ? error.message : String(error);
                    console.warn(JSON.stringify({
                        event: "kill_switch_pagerduty_failed",
                        repo: alert.repoFullName,
                        message: message.slice(0, 200),
                    }));
                });
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(JSON.stringify({
                event: "kill_switch_pagerduty_failed",
                repo: alert.repoFullName,
                message: message.slice(0, 200),
            }));
        }
    }
    return recorded;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ292ZXJub3Ita2lsbC1zd2l0Y2guanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJnb3Zlcm5vci1raWxsLXN3aXRjaC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSw4R0FBOEc7QUFDOUcsd0dBQXdHO0FBQ3hHLDJHQUEyRztBQUMzRyx1R0FBdUc7QUFDdkcsRUFBRTtBQUNGLGtIQUFrSDtBQUNsSCwyR0FBMkc7QUFDM0csMkdBQTJHO0FBQzNHLDJGQUEyRjtBQUUzRixPQUFPLEVBQ0wsa0NBQWtDLEVBQ2xDLGlEQUFpRCxFQUNqRCx1QkFBdUIsRUFDdkIsdUJBQXVCLEVBQ3ZCLHNCQUFzQixHQUV2QixNQUFNLGtCQUFrQixDQUFDO0FBRTFCLE9BQU8sRUFBRSxtQkFBbUIsRUFBRSxNQUFNLHNCQUFzQixDQUFDO0FBYTNEOzs7R0FHRztBQUNILE1BQU0sVUFBVSxvQkFBb0IsQ0FBQyxRQUFtQyxFQUFFO0lBQ3hFLE1BQU0sR0FBRyxHQUFHLEtBQUssQ0FBQyxHQUFHLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQztJQUNyQyxNQUFNLE1BQU0sR0FBRyx1QkFBdUIsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUM1QyxNQUFNLEtBQUssR0FBRyxzQkFBc0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7SUFDL0UsT0FBTyxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsdUJBQXVCLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztBQUMzRCxDQUFDO0FBY0QsTUFBTSxvQkFBb0IsR0FBRyx5Q0FBeUMsQ0FBQztBQUN2RSxNQUFNLGNBQWMsR0FBRyxpQkFBaUIsQ0FBQztBQUN6QyxNQUFNLFVBQVUsR0FBRyxvQkFBb0IsQ0FBQztBQUV4QyxTQUFTLFNBQVMsQ0FBQyxHQUF1QyxFQUFFLElBQVk7SUFDdEUsTUFBTSxLQUFLLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3hCLE9BQU8s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