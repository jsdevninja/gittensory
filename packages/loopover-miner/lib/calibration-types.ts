// Shared calibration shapes for the miner self-improvement phase (#2332). Types-only scaffolding —
// report/ledger/metrics issues build on this module. Field names mirror `GateEvalRow` /
// `GateEvalReport` in `src/review/parity.ts` for easy mental mapping without importing cloud code.

/** A single gate-prediction row the miner will replay against observed outcomes. */
export type PredictedVerdictRecord = {
  targetId: string;
  project: string;
  predictedDecision: string;
  recordedAt: string;
  source?: string;
};

/** The realized human outcome for a previously predicted target. */
export type ObservedOutcomeRecord = {
  targetId: string;
  project: string;
  outcomeDecision: string;
  recordedAt: string;
};

/** Per-project confusion-matrix row — field names mirror `GateEvalRow` in `src/review/parity.ts`. */
export type CalibrationRow = {
  project: string;
  wouldMerge: number;
  mergeConfirmed: number;
  mergeFalse: number;
  wouldClose: number;
  closeConfirmed: number;
  closeFalse: number;
  hold: number;
  decided: number;
  mergePrecision: number | null;
  closePrecision: number | null;
};

/** Aggregate calibration report over one or more projects. */
export type CalibrationReport = {
  rows: CalibrationRow[];
  /** True once at least one project has enough decided samples to read meaningfully. */
  hasSignal: boolean;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNullableRatio(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
}

export function isPredictedVerdictRecord(value: unknown): value is PredictedVerdictRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    isNonEmptyString(record.targetId)
    && isNonEmptyString(record.project)
    && isNonEmptyString(record.predictedDecision)
    && isNonEmptyString(record.recordedAt)
    && isOptionalString(record.source)
  );
}

export function isObservedOutcomeRecord(value: unknown): value is ObservedOutcomeRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    isNonEmptyString(record.targetId)
    && isNonEmptyString(record.project)
    && isNonEmptyString(record.outcomeDecision)
    && isNonEmptyString(record.recordedAt)
  );
}

export function isCalibrationRow(value: unknown): value is CalibrationRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    isNonEmptyString(row.project)
    && isNonNegativeInteger(row.wouldMerge)
    && isNonNegativeInteger(row.mergeConfirmed)
    && isNonNegativeInteger(row.mergeFalse)
    && isNonNegativeInteger(row.wouldClose)
    && isNonNegativeInteger(row.closeConfirmed)
    && isNonNegativeInteger(row.closeFalse)
    && isNonNegativeInteger(row.hold)
    && isNonNegativeInteger(row.decided)
    && isNullableRatio(row.mergePrecision)
    && isNullableRatio(row.closePrecision)
  );
}

export function isCalibrationReport(value: unknown): value is CalibrationReport {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return (
    typeof report.hasSignal === "boolean"
    && Array.isArray(report.rows)
    && report.rows.every((row) => isCalibrationRow(row))
  );
}
