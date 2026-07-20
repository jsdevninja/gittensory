import { buildOpenPrSpec, fingerprintFromChangedFiles } from "@loopover/engine";
import { runIterateLoop } from "@loopover/engine";
import { checkSubmissionFreshness } from "./submission-freshness-check.js";
import { evaluateGovernorChokepointGatePersisted } from "./governor-chokepoint-persisted.js";
import { listRecentOwnSubmissions } from "./governor-state.js";
import { prepareOpenPrSubmission } from "./harness-submission-trigger.js";
import { captureMinerError } from "./sentry.js";
export const ATTEMPT_OUTCOMES = Object.freeze([
    "abandon",
    "stale",
    "blocked",
    "governed",
    "submitted",
]);
// The real driving-loop entrypoint (#2337): the missing link between #2333's iterate-loop orchestrator and an
// actual, executed open_pr write. Composes, in order: runIterateLoop (create -> score -> self-review -> decide,
// #2333) -> on handoff, checkSubmissionFreshness (#3007) -> prepareOpenPrSubmission (#2336/#2337) -> the
// Governor chokepoint (#2340, which itself composes kill-switch, dry-run, rate-limit, budget caps, non-
// convergence, self-reputation-throttle, and self-plagiarism -- see chokepoint.ts's own module doc comment for
// the exact precedence ladder) -> on allowed:true, builds the REAL open_pr command via the now-shared
// buildOpenPrSpec (@loopover/engine, moved from root src/mcp/local-write-tools.ts) and executes it.
//
// WORKTREE LIFECYCLE IS NOT THIS MODULE'S JOB: runIterateLoop already takes a plain `workingDirectory` string
// (packages/loopover-engine/src/miner/iterate-loop.ts's own IterateLoopInput), deliberately agnostic about
// where it came from. Allocating one is the caller's job, via the already-built slot allocator
// (worktree-allocator.js, #4297) -- this module composes the create/review/gate/submit sequence #2337 is
// actually about, not worktree allocation policy, which is a separate, already-solved concern.
//
// `deps.runSlopAssessment` stays INJECTED rather than imported here (this module composes the sequence and is
// agnostic about the scorer behind the seam), but it is no longer unwired: slop-assessment.js (#5133) is its
// real production binding -- a direct pass-through to the engine's own buildSlopAssessment -- and attempt-cli.js
// wires that binding in on the production path. The seam was injected-but-unwired when this module was written
// only because the deterministic scorer was not yet portable; #5133 extracted src/signals/slop.ts's PR-side
// scorer into packages/loopover-engine/src/signals/slop.ts (byte-parity-verified against the live gate's own
// copy), closing the gap this header used to document. This function still requires a real implementation be
// injected rather than silently stubbing a result that would either always pass (unsafe) or always fail
// (useless).
//
// `input.governor`'s cross-attempt state (rate-limit buckets, backoff attempts, budget-cap usage) DOES now
// persist across separate process invocations (#5134, governor-state.js), via
// evaluateGovernorChokepointGatePersisted -- callers no longer need to hand-thread honest empty/zero defaults
// on every invocation; `capUsage` is loaded from that same store but its post-attempt save stays the caller's
// job (see governor-chokepoint-persisted.js's own header for why: nothing computes "the next capUsage" from a
// verdict, only the attempt's real outcome does). Self-plagiarism state is now wired here (#5676): the
// prospective submission's real diff `selfPlagiarismCandidate` (fingerprintFromChangedFiles over the handoff
// packet's changed files) and the miner's real `selfPlagiarismRecentSubmissions` (governor-state.js's
// listRecentOwnSubmissions) are computed late -- right before the chokepoint call, after handoff, where the
// changed files first exist -- and passed in, so chokepoint.ts's selfPlagiarismCheck finally runs on real data.
// `input.governor.reputationHistory` remains a caller-supplied optional field, not auto-loaded here yet.
function assertFn(value, name) {
    if (typeof value !== "function")
        throw new Error(`invalid_${name}`);
}
function assertDeps(deps) {
    if (!deps || typeof deps !== "object")
        throw new Error("invalid_attempt_deps");
    const candidate = deps;
    assertFn(candidate.runSlopAssessment, "run_slop_assessment");
    assertFn(candidate.appendAttemptLogEvent, "append_attempt_log_event");
    assertFn(candidate.fetchLiveIssueSnapshot, "fetch_live_issue_snapshot");
    assertFn(candidate.executeLocalWrite, "execute_local_write");
    const driver = candidate.driver;
    if (!driver || typeof driver.run !== "function")
        throw new Error("invalid_driver");
    const claimLedger = candidate.claimLedger;
    if (!claimLedger || typeof claimLedger.listClaims !== "function")
        throw new Error("invalid_claim_ledger");
    const eventLedger = candidate.eventLedger;
    if (!eventLedger || typeof eventLedger.appendEvent !== "function")
        throw new Error("invalid_event_ledger");
    if (typeof candidate.nowMs !== "number" || !Number.isFinite(candidate.nowMs))
        throw new Error("invalid_now_ms");
}
function assertInput(input) {
    if (!input || typeof input !== "object")
        throw new Error("invalid_attempt_input");
    const candidate = input;
    if (!candidate.loopInput || typeof candidate.loopInput !== "object")
        throw new Error("invalid_loop_input");
    if (!Number.isInteger(candidate.issueNumber) || candidate.issueNumber < 1) {
        throw new Error("invalid_issue_number");
    }
    if (typeof candidate.minerLogin !== "string" || !candidate.minerLogin.trim())
        throw new Error("invalid_miner_login");
    if (typeof candidate.base !== "string" || !candidate.base.trim())
        throw new Error("invalid_base");
    if (!["global", "repo", "none"].includes(candidate.killSwitchScope)) {
        throw new Error("invalid_kill_switch_scope");
    }
    if (!["clean", "low", "elevated", "high"].includes(candidate.slopThreshold)) {
        throw new Error("invalid_slop_threshold");
    }
    if (!["observe", "enforce"].includes(candidate.submissionMode))
        throw new Error("invalid_submission_mode");
    if (!candidate.governor || typeof candidate.governor !== "object")
        throw new Error("invalid_governor_context");
}
/**
 * Run one full attempt end to end: iterate-loop -> (on handoff) freshness -> submission-gate -> Governor
 * chokepoint -> (on allowed:true) build + execute the real open_pr command. Fails closed (throws) on malformed
 * input/deps, mirroring every sibling module in this pipeline.
 */
export async function runMinerAttempt(input, deps) {
    assertInput(input);
    assertDeps(deps);
    const loopResult = await runIterateLoop(input.loopInput, {
        driver: deps.driver,
        // AttemptDeps deliberately keeps this loosely typed (`(input: unknown) => unknown`) at the public boundary --
        // the real, narrower shape (SelfReviewAdapterDeps["runSlopAssessment"]) is an engine-internal detail callers
        // shouldn't need to import just to satisfy this dependency's type.
        runSlopAssessment: deps.runSlopAssessment,
        appendAttemptLogEvent: deps.appendAttemptLogEvent,
        ...(typeof deps.shouldAbort === "function" ? { shouldAbort: deps.shouldAbort } : {}),
    });
    if (loopResult.outcome === "abandon") {
        return { outcome: "abandon", loopResult };
    }
    // Populated by design whenever outcome !== "abandon" (IterateLoopOutcome is only ever "handoff" | "abandon",
    // and handoffPacket is only ever set on "handoff") -- runIterateLoop's own type keeps the field optional
    // because it models both outcomes in one result shape.
    const handoffPacket = loopResult.handoffPacket;
    // Re-check kill-switch AFTER handoff and BEFORE any write (#5670) when a live resolver is supplied.
    // Without a live resolver, preserve pre-#5670 behavior: the frozen attempt-start scope is threaded into
    // prepareOpenPrSubmission / the submission gate (which itself denies active kill scopes).
    if (typeof deps.resolveKillSwitchScope === "function") {
        const liveKillSwitchScope = deps.resolveKillSwitchScope();
        if (liveKillSwitchScope !== "none") {
            return {
                outcome: "abandon",
                loopResult: {
                    ...loopResult,
                    outcome: "abandon",
                    finalDecision: {
                        action: "abandon",
                        abandonReason: "kill_switch_engaged",
                        reason: `Kill-switch (${liveKillSwitchScope}) engaged after handoff; refusing to open a PR.`,
                    },
                    handoffPacket: undefined,
                },
            };
        }
    }
    const freshness = await checkSubmissionFreshness({ repoFullName: input.loopInput.repoFullName, issueNumber: input.issueNumber, minerLogin: input.minerLogin }, { claimLedger: deps.claimLedger, fetchLiveIssueSnapshot: deps.fetchLiveIssueSnapshot, eventLedger: deps.eventLedger });
    if (!freshness.fresh) {
        return { outcome: "stale", reason: freshness.reason, loopResult };
    }
    const submission = await prepareOpenPrSubmission({
        killSwitchScope: input.killSwitchScope,
        repoFullName: input.loopInput.repoFullName,
        // HandoffPacket's optional fields are typed `| undefined` (engine's exactOptionalPropertyTypes style);
        // HarnessSubmissionCandidateInput's narrower local field type omits that -- both describe the same real
        // shape, so the cast just bridges the two independently-declared-but-compatible types.
        handoffPacket: handoffPacket,
        slopThreshold: input.slopThreshold,
        mode: input.submissionMode,
        // Spread-omit rather than pass `undefined` explicitly -- PrepareOpenPrSubmissionCandidate's optional
        // fields don't declare `| undefined`, and exactOptionalPropertyTypes treats those as different.
        ...(input.maxConsecutiveGateBlocks !== undefined
            ? { maxConsecutiveGateBlocks: input.maxConsecutiveGateBlocks }
            : {}),
        base: input.base,
        title: input.loopInput.title,
        body: input.loopInput.body ?? "",
        ...(input.draft !== undefined ? { draft: input.draft } : {}),
    }, { eventLedger: deps.eventLedger, ...(deps.sessionStartMs !== undefined ? { sessionStartMs: deps.sessionStartMs } : {}) });
    if (!submission.ready) {
        return { outcome: "blocked", decision: submission.decision, loopResult };
    }
    // Late-augment the self-plagiarism inputs (#5676): the prospective submission's real diff fingerprint and the
    // miner's real recent-submission history only exist HERE, after handoff -- attempt-cli.js's single early
    // governor snapshot (buildAttemptGovernorContext) is built before any changed files exist, so it cannot carry
    // them. This finally feeds chokepoint.ts's selfPlagiarismCheck, which was previously always skipped for lack of
    // data. Read the history from the SAME governor-state store the chokepoint itself uses (deps.governorState when
    // provided, else the persisted default via the module-level export). Fail open on a read failure so a
    // history-store hiccup never blocks an otherwise-allowed real submission.
    /* v8 ignore next -- buildHandoffPacket always populates changedFiles; the `?? []` only guards a hand-built packet */
    const changedFilePaths = (handoffPacket.changedFiles ?? []).map((file) => file.path);
    const selfPlagiarismCandidate = {
        repoFullName: input.loopInput.repoFullName,
        fingerprint: fingerprintFromChangedFiles(changedFilePaths),
        // The prospective submission's own time is "now" -- selfPlagiarismCheck needs a real submittedAt on the
        // candidate (it denies a candidate lacking one) and uses it for earliest-claimant election vs the priors.
        submittedAt: new Date(deps.nowMs).toISOString(),
    };
    let selfPlagiarismRecentSubmissions;
    try {
        selfPlagiarismRecentSubmissions = deps.governorState
            ? deps.governorState.listRecentOwnSubmissions({ repoFullName: input.loopInput.repoFullName })
            : listRecentOwnSubmissions({ repoFullName: input.loopInput.repoFullName });
    }
    catch (error) {
        // Fail-open is deliberate (see the comment above) -- this only makes the fallback VISIBLE. A broken
        // governor-state store silently disabling the self-plagiarism safety check had zero trace anywhere (#6011).
        captureMinerError(error, { kind: "self_plagiarism_history_read_failed", repoFullName: input.loopInput.repoFullName });
        selfPlagiarismRecentSubmissions = [];
    }
    const governed = evaluateGovernorChokepointGatePersisted({
        actionClass: "open_pr",
        repoFullName: input.loopInput.repoFullName,
        nowMs: deps.nowMs,
        wouldBeAction: submission.openPrInput,
        ...input.governor,
        selfPlagiarismCandidate,
        selfPlagiarismRecentSubmissions,
    }, {
        // AttemptDeps deliberately keeps governorLedgerAppend loosely typed (`(event: unknown) => unknown`) at the
        // public boundary, same as runSlopAssessment above -- cast to the engine-internal signature here.
        ...(deps.governorLedgerAppend
            ? { append: deps.governorLedgerAppend }
            : {}),
        ...(deps.governorState ? { governorState: deps.governorState } : {}),
    });
    if (!governed.decision.allowed) {
        return { outcome: "governed", decision: governed.decision, loopResult };
    }
    const spec = buildOpenPrSpec(submission.openPrInput);
    const execResult = await deps.executeLocalWrite(spec);
    return { outcome: "submitted", spec, execResult, loopResult };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXR0ZW1wdC1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhdHRlbXB0LXJ1bm5lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFVQSxPQUFPLEVBQUUsZUFBZSxFQUFFLDJCQUEyQixFQUFFLE1BQU0sa0JBQWtCLENBQUM7QUFDaEYsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLGtCQUFrQixDQUFDO0FBTWxELE9BQU8sRUFBRSx3QkFBd0IsRUFBRSxNQUFNLGlDQUFpQyxDQUFDO0FBRTNFLE9BQU8sRUFBRSx1Q0FBdUMsRUFBRSxNQUFNLG9DQUFvQyxDQUFDO0FBRzdGLE9BQU8sRUFBRSx3QkFBd0IsRUFBRSxNQUFNLHFCQUFxQixDQUFDO0FBTS9ELE9BQU8sRUFBRSx1QkFBdUIsRUFBRSxNQUFNLGlDQUFpQyxDQUFDO0FBQzFFLE9BQU8sRUFBRSxpQkFBaUIsRUFBRSxNQUFNLGFBQWEsQ0FBQztBQUVoRCxNQUFNLENBQUMsTUFBTSxnQkFBZ0IsR0FBc0UsTUFBTSxDQUFDLE1BQU0sQ0FBQztJQUMvRyxTQUFTO0lBQ1QsT0FBTztJQUNQLFNBQVM7SUFDVCxVQUFVO0lBQ1YsV0FBVztDQUNaLENBQUMsQ0FBQztBQXFESCw4R0FBOEc7QUFDOUcsZ0hBQWdIO0FBQ2hILHlHQUF5RztBQUN6Ryx3R0FBd0c7QUFDeEcsK0dBQStHO0FBQy9HLHNHQUFzRztBQUN0RyxvR0FBb0c7QUFDcEcsRUFBRTtBQUNGLDhHQUE4RztBQUM5RywyR0FBMkc7QUFDM0csK0ZBQStGO0FBQy9GLHlHQUF5RztBQUN6RywrRkFBK0Y7QUFDL0YsRUFBRTtBQUNGLDhHQUE4RztBQUM5Ryw2R0FBNkc7QUFDN0csaUhBQWlIO0FBQ2pILCtHQUErRztBQUMvRyw0R0FBNEc7QUFDNUcsNkdBQTZHO0FBQzdHLDZHQUE2RztBQUM3Ryx3R0FBd0c7QUFDeEcsYUFBYTtBQUNiLEVBQUU7QUFDRiwyR0FBMkc7QUFDM0csOEVBQThFO0FBQzlFLDhHQUE4RztBQUM5Ryw4R0FB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