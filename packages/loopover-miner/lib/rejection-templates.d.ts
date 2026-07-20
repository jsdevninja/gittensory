export type RejectionReason = "gate_close" | "maintainer_close_no_reason" | "superseded_by_duplicate";
export type RejectionContext = {
    repoFullName: string;
    prNumber: number;
};
/** The supported rejection-reason buckets, in declaration order. */
export declare const REJECTION_REASONS: readonly RejectionReason[];
/** True when the given text contains any banned private-language token. */
export declare function containsPrivateLanguage(text: string): boolean;
/**
 * Substitute every `{placeholder}` token in `template` from `values`, throwing rather than emitting a
 * half-rendered note if any placeholder is unmapped (`missing_placeholder:<key>`) or if a substituted value's
 * own text still leaves what looks like an unresolved placeholder in the output (`unresolved_placeholder`) --
 * defense-in-depth against a future template-authoring bug, not a route `renderRejectionMessage` itself can hit
 * today given the fixed {@link REJECTION_REASONS} vocabulary (exported so both guards are directly unit-testable
 * without needing a malformed production template). Pure and deterministic.
 */
export declare function resolvePlaceholders(template: string, values: Record<string, string | number>): string;
/**
 * Render the courtesy note for a closed/rejected PR. `reason` must be one of {@link REJECTION_REASONS}; `context`
 * supplies `repoFullName` (`owner/repo`) and `prNumber` (a positive integer). Throws on an unknown reason or a
 * malformed context. Pure and deterministic.
 */
export declare function renderRejectionMessage(reason: RejectionReason, context: RejectionContext): string;
