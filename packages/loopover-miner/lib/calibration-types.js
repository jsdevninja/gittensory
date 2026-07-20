// Shared calibration shapes for the miner self-improvement phase (#2332). Types-only scaffolding —
// report/ledger/metrics issues build on this module. Field names mirror `GateEvalRow` /
// `GateEvalReport` in `src/review/parity.ts` for easy mental mapping without importing cloud code.
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function isOptionalString(value) {
    return value === undefined || isNonEmptyString(value);
}
function isNonNegativeInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
function isNullableRatio(value) {
    return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
}
export function isPredictedVerdictRecord(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const record = value;
    return (isNonEmptyString(record.targetId)
        && isNonEmptyString(record.project)
        && isNonEmptyString(record.predictedDecision)
        && isNonEmptyString(record.recordedAt)
        && isOptionalString(record.source));
}
export function isObservedOutcomeRecord(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const record = value;
    return (isNonEmptyString(record.targetId)
        && isNonEmptyString(record.project)
        && isNonEmptyString(record.outcomeDecision)
        && isNonEmptyString(record.recordedAt));
}
export function isCalibrationRow(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const row = value;
    return (isNonEmptyString(row.project)
        && isNonNegativeInteger(row.wouldMerge)
        && isNonNegativeInteger(row.mergeConfirmed)
        && isNonNegativeInteger(row.mergeFalse)
        && isNonNegativeInteger(row.wouldClose)
        && isNonNegativeInteger(row.closeConfirmed)
        && isNonNegativeInteger(row.closeFalse)
        && isNonNegativeInteger(row.hold)
        && isNonNegativeInteger(row.decided)
        && isNullableRatio(row.mergePrecision)
        && isNullableRatio(row.closePrecision));
}
export function isCalibrationReport(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const report = value;
    return (typeof report.hasSignal === "boolean"
        && Array.isArray(report.rows)
        && report.rows.every((row) => isCalibrationRow(row)));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2FsaWJyYXRpb24tdHlwZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjYWxpYnJhdGlvbi10eXBlcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxtR0FBbUc7QUFDbkcsd0ZBQXdGO0FBQ3hGLG1HQUFtRztBQXlDbkcsU0FBUyxnQkFBZ0IsQ0FBQyxLQUFjO0lBQ3RDLE9BQU8sT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0FBQzlELENBQUM7QUFFRCxTQUFTLGdCQUFnQixDQUFDLEtBQWM7SUFDdEMsT0FBTyxLQUFLLEtBQUssU0FBUyxJQUFJLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ3hELENBQUM7QUFFRCxTQUFTLG9CQUFvQixDQUFDLEtBQWM7SUFDMUMsT0FBTyxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksTUFBTSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsSUFBSSxLQUFLLElBQUksQ0FBQyxDQUFDO0FBQzVFLENBQUM7QUFFRCxTQUFTLGVBQWUsQ0FBQyxLQUFjO0lBQ3JDLE9BQU8sS0FBSyxLQUFLLElBQUksSUFBSSxDQUFDLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEtBQUssSUFBSSxDQUFDLElBQUksS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBQzdHLENBQUM7QUFFRCxNQUFNLFVBQVUsd0JBQXdCLENBQUMsS0FBYztJQUNyRCxJQUFJLEtBQUssS0FBSyxJQUFJLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO1FBQUUsT0FBTyxLQUFLLENBQUM7SUFDdEYsTUFBTSxNQUFNLEdBQUcsS0FBZ0MsQ0FBQztJQUNoRCxPQUFPLENBQ0wsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQztXQUM5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