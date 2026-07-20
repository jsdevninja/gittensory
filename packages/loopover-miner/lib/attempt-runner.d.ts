import type { CodingAgentDriver, GovernorDecision, IterateLoopInput, IterateLoopResult, IterateLoopShouldAbort, LocalWriteActionSpec } from "@loopover/engine";
import type { FreshnessAbortReason, LiveIssueSnapshot, SubmissionFreshnessClaimLedger } from "./submission-freshness-check.js";
import type { GovernorChokepointInputPersisted } from "./governor-chokepoint-persisted.js";
import type { GovernorState } from "./governor-state.js";
import type { HarnessSubmissionDecision, HarnessSubmissionEventLedger } from "./harness-submission-trigger.js";
export declare const ATTEMPT_OUTCOMES: readonly ["abandon", "stale", "blocked", "governed", "submitted"];
export type AttemptGovernorContext = Omit<GovernorChokepointInputPersisted, "actionClass" | "repoFullName" | "nowMs" | "wouldBeAction">;
export type AttemptInput = {
    loopInput: IterateLoopInput;
    issueNumber: number;
    minerLogin: string;
    base: string;
    killSwitchScope: "global" | "repo" | "none";
    slopThreshold: "clean" | "low" | "elevated" | "high";
    submissionMode: "observe" | "enforce";
    maxConsecutiveGateBlocks?: number;
    draft?: boolean;
    governor: AttemptGovernorContext;
};
export type AttemptDeps = {
    driver: CodingAgentDriver;
    runSlopAssessment: (input: unknown) => unknown;
    appendAttemptLogEvent: (event: unknown) => void;
    claimLedger: SubmissionFreshnessClaimLedger;
    fetchLiveIssueSnapshot: (repoFullName: string, issueNumber: number) => Promise<LiveIssueSnapshot | null>;
    eventLedger: HarnessSubmissionEventLedger;
    /** Injected governor-ledger append (mirrors evaluateGovernorChokepointGate's own `options.append`); omitted
     *  falls back to that function's own default (the real default governor ledger). */
    governorLedgerAppend?: (event: unknown) => unknown;
    /** Injected governor-state store (#5134); omitted falls back to evaluateGovernorChokepointGatePersisted's
     *  own default (opens + closes the real default governor-state store for this one call). */
    governorState?: GovernorState;
    sessionStartMs?: number;
    nowMs: number;
    executeLocalWrite: (spec: LocalWriteActionSpec) => Promise<unknown>;
    /** Mid-attempt kill-switch probe threaded into `runIterateLoop` (#5670). */
    shouldAbort?: () => IterateLoopShouldAbort;
    /** Live kill-switch scope resolver after handoff (#5670); defaults to the frozen attempt-start scope. */
    resolveKillSwitchScope?: () => "global" | "repo" | "none";
};
export type AttemptResult = {
    outcome: "abandon";
    loopResult: IterateLoopResult;
} | {
    outcome: "stale";
    reason: FreshnessAbortReason;
    loopResult: IterateLoopResult;
} | {
    outcome: "blocked";
    decision: HarnessSubmissionDecision;
    loopResult: IterateLoopResult;
} | {
    outcome: "governed";
    decision: GovernorDecision;
    loopResult: IterateLoopResult;
} | {
    outcome: "submitted";
    spec: LocalWriteActionSpec;
    execResult: unknown;
    loopResult: IterateLoopResult;
};
/**
 * Run one full attempt end to end: iterate-loop -> (on handoff) freshness -> submission-gate -> Governor
 * chokepoint -> (on allowed:true) build + execute the real open_pr command. Fails closed (throws) on malformed
 * input/deps, mirroring every sibling module in this pipeline.
 */
export declare function runMinerAttempt(input: AttemptInput, deps: AttemptDeps): Promise<AttemptResult>;
