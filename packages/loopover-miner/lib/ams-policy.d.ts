import type { AmsPolicySpec } from "@loopover/engine";
export type AmsPolicySource = "local" | "default";
export type ResolvedAmsPolicy = {
    spec: AmsPolicySpec;
    source: AmsPolicySource;
    warnings: string[];
};
export type AmsPolicyOptions = {
    /** Accepted for forward/API compatibility with callers that pass a fetch override; unused today since this
     *  resolver never fetches (see the module doc comment above). */
    fetchImpl?: unknown;
    readFileSync?: (path: string, encoding: "utf8") => string;
    existsSync?: (path: string) => boolean;
    env?: Record<string, string | undefined>;
};
/** Resolve the operator's local AMS policy file path: explicit env var > `LOOPOVER_MINER_CONFIG_DIR` >
 *  `XDG_CONFIG_HOME`/`~/.config`, mirroring every other local-store path in this package. */
export declare function resolveAmsPolicyConfigPath(env?: Record<string, string | undefined>): string;
/**
 * Resolve the real, effective AMS execution policy for one attempt: the operator's own local
 * `.loopover-ams.yml` when present (source: "local"), else the engine's safe defaults (source: "default").
 * Never throws -- an unreadable/malformed local file degrades through the tolerant parser to the safe
 * defaults, same discipline as every other tolerant parser in this pipeline.
 *
 * `repoFullName` is accepted for API compatibility with callers that resolve policy per target repo, but the
 * resolver intentionally does not fetch or trust target-repository AMS policy content.
 */
export declare function resolveAmsPolicy(repoFullName: string, options?: AmsPolicyOptions): Promise<ResolvedAmsPolicy>;
