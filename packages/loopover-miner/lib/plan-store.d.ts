export type PlanStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type PlanStep = {
    id: string;
    title: string;
    actionClass?: string;
    dependsOn: string[];
    status: PlanStepStatus;
    attempts: number;
    maxAttempts: number;
    lastError?: string | null;
};
export type PlanDag = {
    steps: PlanStep[];
};
export type PlanStatus = "pending" | "running" | "completed" | "failed";
export type PlanRecord = {
    planId: string;
    plan: PlanDag;
    status: PlanStatus;
    updatedAt: string;
};
export type ListPlansFilter = {
    status?: PlanStatus | null;
};
export type PlanStore = {
    dbPath: string;
    savePlan(planId: string, plan: PlanDag): PlanRecord;
    loadPlan(planId: string): PlanRecord | null;
    listPlans(filter?: ListPlansFilter): PlanRecord[];
    close(): void;
};
/** Derived plan-level status used for `listPlans({ status })`. */
export declare const PLAN_STATUSES: readonly PlanStatus[];
export declare function resolvePlanStoreDbPath(env?: Record<string, string | undefined>): string;
/**
 * Opens the local plan store, creating the table on first use. `savePlan` is a single atomic INSERT…ON CONFLICT
 * upsert keyed by `plan_id`; the plan JSON is validated on save AND re-validated on load, so a corrupted row is
 * rejected rather than silently returned. (#2318)
 */
export declare function openPlanStore(dbPath?: string): PlanStore;
export declare function savePlan(planId: string, plan: PlanDag): PlanRecord;
export declare function loadPlan(planId: string): PlanRecord | null;
export declare function listPlans(filter?: ListPlansFilter): PlanRecord[];
export declare function closeDefaultPlanStore(): void;
