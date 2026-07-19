import { normalizeLocalStoreDbPath, openLocalStoreDb, resolveLocalStoreDbPath } from "./local-store.js";
import { applySchemaMigrations } from "./schema-version.js";
const PLAN_STEP_STATUSES = Object.freeze([
    "pending",
    "running",
    "completed",
    "failed",
    "skipped",
]);
/** Derived plan-level status used for `listPlans({ status })`. */
export const PLAN_STATUSES = Object.freeze(["pending", "running", "completed", "failed"]);
const stepStatusSet = new Set(PLAN_STEP_STATUSES);
const planStatusSet = new Set(PLAN_STATUSES);
const defaultDbFileName = "plan-store.sqlite3";
let defaultPlanStore = null;
export function resolvePlanStoreDbPath(env = process.env) {
    return resolveLocalStoreDbPath(defaultDbFileName, "LOOPOVER_MINER_PLAN_STORE_DB", env);
}
function normalizeDbPath(dbPath) {
    return normalizeLocalStoreDbPath(dbPath, resolvePlanStoreDbPath(), "invalid_plan_store_db_path");
}
function normalizePlanId(planId) {
    if (typeof planId !== "string" || !planId.trim())
        throw new Error("invalid_plan_id");
    return planId.trim();
}
function normalizePlanStatusFilter(status) {
    if (status === undefined || status === null)
        return undefined;
    if (!planStatusSet.has(status))
        throw new Error("invalid_status");
    return status;
}
function isBoundedString(value, min, max) {
    return typeof value === "string" && value.length >= min && value.length <= max;
}
function isBoundedInt(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
}
const STEP_KEYS = new Set(["id", "title", "actionClass", "dependsOn", "status", "attempts", "maxAttempts", "lastError"]);
function isValidStep(step) {
    if (!step || typeof step !== "object" || Array.isArray(step))
        return false;
    for (const key of Object.keys(step))
        if (!STEP_KEYS.has(key))
            return false; // strict: no unknown keys
    const candidate = step;
    if (!isBoundedString(candidate.id, 1, 100) || !isBoundedString(candidate.title, 1, 300))
        return false;
    if (candidate.actionClass !== undefined && !isBoundedString(candidate.actionClass, 1, 60))
        return false;
    if (!Array.isArray(candidate.dependsOn) || candidate.dependsOn.length > 50)
        return false;
    if (!candidate.dependsOn.every((dep) => isBoundedString(dep, 1, 100)))
        return false;
    if (!stepStatusSet.has(candidate.status))
        return false;
    if (!isBoundedInt(candidate.attempts, 0, Number.MAX_SAFE_INTEGER))
        return false;
    if (!isBoundedInt(candidate.maxAttempts, 1, 10))
        return false;
    if (candidate.lastError !== undefined
        && candidate.lastError !== null
        && !isBoundedString(candidate.lastError, 0, 2000)) {
        return false;
    }
    return true;
}
/** Validate a plan against the `planDagSchema` shape (strict `{ steps: PlanStep[] }`, ≤100 steps). Throws on any
 *  malformed field so a bad plan can neither be saved nor read back. */
function validatePlanDag(plan) {
    if (!plan || typeof plan !== "object" || Array.isArray(plan))
        throw new Error("invalid_plan");
    const keys = Object.keys(plan);
    if (keys.length !== 1 || keys[0] !== "steps")
        throw new Error("invalid_plan");
    const candidate = plan;
    if (!Array.isArray(candidate.steps) || candidate.steps.length === 0 || candidate.steps.length > 100) {
        throw new Error("invalid_plan");
    }
    if (!candidate.steps.every(isValidStep))
        throw new Error("invalid_plan");
    const steps = candidate.steps;
    const seenStepIds = new Set();
    for (const step of steps) {
        if (seenStepIds.has(step.id))
            throw new Error("invalid_plan");
        seenStepIds.add(step.id);
    }
    for (const step of steps) {
        for (const dep of step.dependsOn) {
            if (dep === step.id || !seenStepIds.has(dep))
                throw new Error("invalid_plan");
        }
    }
    const color = new Map();
    const byId = new Map(steps.map((step) => [step.id, step]));
    const hasCycle = (id) => {
        color.set(id, 1);
        // Non-null: every `id` this is called with is either a step's own id (inserted into `byId` above) or a
        // `dep` whose `byId.has(dep)` was just confirmed true by the caller -- `byId.get(id)` can never miss here.
        for (const dep of byId.get(id).dependsOn) {
            const depColor = color.get(dep) ?? 0;
            if (depColor === 1)
                return true;
            if (depColor === 0 && byId.has(dep) && hasCycle(dep))
                return true;
        }
        color.set(id, 2);
        return false;
    };
    for (const step of steps) {
        if ((color.get(step.id) ?? 0) === 0 && hasCycle(step.id)) {
            throw new Error("invalid_plan");
        }
    }
    return { steps };
}
/** Derive a plan-level status from its steps: any failed → failed; else any running → running; else all steps
 *  finished (completed/skipped) with at least one step → completed; otherwise pending. */
function computePlanStatus(plan) {
    const steps = plan.steps;
    if (steps.some((step) => step.status === "failed"))
        return "failed";
    if (steps.some((step) => step.status === "running"))
        return "running";
    if (steps.length > 0 && steps.every((step) => step.status === "completed" || step.status === "skipped")) {
        return "completed";
    }
    return "pending";
}
function rowToRecord(row) {
    let plan;
    try {
        plan = validatePlanDag(JSON.parse(row.plan_json));
    }
    catch {
        throw new Error("corrupted_plan_row"); // stored blob no longer matches the plan shape
    }
    // Also fail closed on the status column: a manually-edited or legacy row (predating the CHECK constraint) could
    // hold a status outside PLAN_STATUSES, which would otherwise violate the exported PlanRecord contract on read.
    if (!planStatusSet.has(row.status))
        throw new Error("corrupted_plan_row");
    return { planId: row.plan_id, plan, status: row.status, updatedAt: row.updated_at };
}
// v1 -> v2 (#4939/#6597): additive tenant-scoping column, a prerequisite for any hosted, multi-tenant use of
// this same store's logic. NULL for every row today -- self-host behavior is byte-identical, since nothing
// reads or writes it yet. Same defensive column-presence guard as this file's sibling stores' own additive
// migrations (e.g. event-ledger.js's addTenantIdColumn).
function addTenantIdColumn(db) {
    const hasTenantIdColumn = db
        .prepare("PRAGMA table_info(miner_plans)")
        .all()
        .some((column) => column.name === "tenant_id");
    if (!hasTenantIdColumn)
        db.exec("ALTER TABLE miner_plans ADD COLUMN tenant_id TEXT");
}
/**
 * Opens the local plan store, creating the table on first use. `savePlan` is a single atomic INSERT…ON CONFLICT
 * upsert keyed by `plan_id`; the plan JSON is validated on save AND re-validated on load, so a corrupted row is
 * rejected rather than silently returned. (#2318)
 */
export function openPlanStore(dbPath = resolvePlanStoreDbPath()) {
    const resolvedPath = normalizeDbPath(dbPath);
    // openLocalStoreDb centralizes the mkdir(0o700)/chmod(0o600)/busy_timeout + crash-safe cleanup registration and
    // treats ':memory:' as a no-file special case, so this store no longer hand-rolls that boilerplate (#4826).
    const db = openLocalStoreDb(resolvedPath);
    db.exec(`
    CREATE TABLE IF NOT EXISTS miner_plans (
      plan_id TEXT PRIMARY KEY,
      plan_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
      updated_at TEXT NOT NULL
    )
  `);
    // Schema-version convention (#4832): stamp the baseline and run any post-baseline migrations.
    applySchemaMigrations(db, [addTenantIdColumn]);
    const saveStatement = db.prepare(`
    INSERT INTO miner_plans (plan_id, plan_json, status, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(plan_id) DO UPDATE SET
      plan_json = excluded.plan_json,
      status = excluded.status,
      updated_at = excluded.updated_at
  `);
    const getStatement = db.prepare("SELECT * FROM miner_plans WHERE plan_id = ?");
    const listAllStatement = db.prepare("SELECT * FROM miner_plans ORDER BY plan_id ASC");
    const listStatusStatement = db.prepare("SELECT * FROM miner_plans WHERE status = ? ORDER BY plan_id ASC");
    return {
        dbPath: resolvedPath,
        savePlan(planId, plan) {
            const id = normalizePlanId(planId);
            validatePlanDag(plan);
            const status = computePlanStatus(plan);
            const updatedAt = new Date().toISOString();
            saveStatement.run(id, JSON.stringify(plan), status, updatedAt);
            return { planId: id, plan, status, updatedAt };
        },
        loadPlan(planId) {
            const row = getStatement.get(normalizePlanId(planId));
            return row ? rowToRecord(row) : null;
        },
        listPlans(filter = {}) {
            const status = normalizePlanStatusFilter(filter.status);
            const rows = (status !== undefined ? listStatusStatement.all(status) : listAllStatement.all());
            return rows.map(rowToRecord);
        },
        close() {
            db.close();
        },
    };
}
function getDefaultPlanStore() {
    defaultPlanStore ??= openPlanStore();
    return defaultPlanStore;
}
export function savePlan(planId, plan) {
    return getDefaultPlanStore().savePlan(planId, plan);
}
export function loadPlan(planId) {
    return getDefaultPlanStore().loadPlan(planId);
}
export function listPlans(filter) {
    return getDefaultPlanStore().listPlans(filter);
}
export function closeDefaultPlanStore() {
    if (!defaultPlanStore)
        return;
    defaultPlanStore.close();
    defaultPlanStore = null;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGxhbi1zdG9yZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInBsYW4tc3RvcmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQ0EsT0FBTyxFQUFFLHlCQUF5QixFQUFFLGdCQUFnQixFQUFFLHVCQUF1QixFQUFFLE1BQU0sa0JBQWtCLENBQUM7QUFDeEcsT0FBTyxFQUFFLHFCQUFxQixFQUFFLE1BQU0scUJBQXFCLENBQUM7QUErQzVELE1BQU0sa0JBQWtCLEdBQThCLE1BQU0sQ0FBQyxNQUFNLENBQUM7SUFDbEUsU0FBUztJQUNULFNBQVM7SUFDVCxXQUFXO0lBQ1gsUUFBUTtJQUNSLFNBQVM7Q0FDVixDQUFDLENBQUM7QUFDSCxrRUFBa0U7QUFDbEUsTUFBTSxDQUFDLE1BQU0sYUFBYSxHQUEwQixNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsU0FBUyxFQUFFLFNBQVMsRUFBRSxXQUFXLEVBQUUsUUFBUSxDQUFDLENBQUMsQ0FBQztBQUVqSCxNQUFNLGFBQWEsR0FBZ0IsSUFBSSxHQUFHLENBQUMsa0JBQWtCLENBQUMsQ0FBQztBQUMvRCxNQUFNLGFBQWEsR0FBZ0IsSUFBSSxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUM7QUFDMUQsTUFBTSxpQkFBaUIsR0FBRyxvQkFBb0IsQ0FBQztBQUMvQyxJQUFJLGdCQUFnQixHQUFxQixJQUFJLENBQUM7QUFFOUMsTUFBTSxVQUFVLHNCQUFzQixDQUFDLE1BQTBDLE9BQU8sQ0FBQyxHQUFHO0lBQzFGLE9BQU8sdUJBQXVCLENBQUMsaUJBQWlCLEVBQUUsOEJBQThCLEVBQUUsR0FBRyxDQUFDLENBQUM7QUFDekYsQ0FBQztBQUVELFNBQVMsZUFBZSxDQUFDLE1BQWlDO0lBQ3hELE9BQU8seUJBQXlCLENBQUMsTUFBTSxFQUFFLHNCQUFzQixFQUFFLEVBQUUsNEJBQTRCLENBQUMsQ0FBQztBQUNuRyxDQUFDO0FBRUQsU0FBUyxlQUFlLENBQUMsTUFBZTtJQUN0QyxJQUFJLE9BQU8sTUFBTSxLQUFLLFFB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