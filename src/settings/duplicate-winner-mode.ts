export type DuplicateWinnerMode = "inherit" | "off" | "enabled";

/** Truthy convention matches the rest of this codebase's `LOOPOVER_*` flags (exact `"true"` string, e.g. the
 *  raw checks this replaces) -- unlike `isSkipAutomationBotPullRequestsEnabledGlobally` (default ON, inverted
 *  truthy match), this flag is opt-in and default OFF: sparing a duplicate cluster's earliest claimant is a
 *  real behavior change to the close disposition, not a low-risk waste-elimination default. */
export function isDuplicateWinnerEnabledGlobally(env: { LOOPOVER_DUPLICATE_WINNER?: string | undefined }): boolean {
  return env.LOOPOVER_DUPLICATE_WINNER === "true";
}

/** Per-repo override resolved against the global default. Mirrors `resolveSkipAutomationBotPullRequests`'s
 *  inherit/off/enabled shape (settings/automation-bot-skip.ts) -- symmetric: "off" and "enabled" both fully
 *  override the global default in either direction, so a repo opting IN is never blocked by a globally-off
 *  default, and a repo opting OUT keeps the legacy "every sibling closes" behavior even when the fleet default
 *  is on. */
export function resolveDuplicateWinnerEnabled(globalDefault: boolean, mode: DuplicateWinnerMode | null | undefined): boolean {
  if (mode === "off") return false;
  if (mode === "enabled") return true;
  return globalDefault;
}
