import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_AMS_POLICY_SPEC, parseAmsPolicySpecContent } from "@loopover/engine";
import { resolveLocalStoreDbPath } from "./local-store.js";
// Resolver for the operator-local `.loopover-ams.yml` (#5132, Wave 3.5 follow-up). AmsPolicySpec
// (ams-policy-spec.ts, engine package) is the type/parser surface; this module is the actual local
// read+resolve caller.
//
// This is deliberately NOT the same resolution shape as self-review-context.js/rejection-signal.js, which
// read from the target repo: AmsPolicySpec's fields are the OPERATOR's own execution-risk policy, so an
// untrusted target repo must never get final say over them.
const AMS_POLICY_FILENAME = ".loopover-ams.yml";
/** Resolve the operator's local AMS policy file path: explicit env var > `LOOPOVER_MINER_CONFIG_DIR` >
 *  `XDG_CONFIG_HOME`/`~/.config`, mirroring every other local-store path in this package. */
export function resolveAmsPolicyConfigPath(env = process.env) {
    return resolveLocalStoreDbPath(AMS_POLICY_FILENAME, "LOOPOVER_MINER_AMS_POLICY_PATH", env);
}
function normalizeOptions(options = {}) {
    return {
        readFileSync: options.readFileSync ?? readFileSync,
        existsSync: options.existsSync ?? existsSync,
        env: options.env ?? process.env,
    };
}
/** Read the operator's own local `.loopover-ams.yml`, if one exists. Never throws: an unreadable file is
 *  treated the same as an absent one, falling through to the next resolution layer. */
function readLocalAmsPolicyContent(resolved) {
    const path = resolveAmsPolicyConfigPath(resolved.env);
    if (!resolved.existsSync(path))
        return null;
    try {
        return resolved.readFileSync(path, "utf8");
    }
    catch {
        return null;
    }
}
/**
 * Resolve the real, effective AMS execution policy for one attempt: the operator's own local
 * `.loopover-ams.yml` when present (source: "local"), else the engine's safe defaults (source: "default").
 * Never throws -- an unreadable/malformed local file degrades through the tolerant parser to the safe
 * defaults, same discipline as every other tolerant parser in this pipeline.
 *
 * `repoFullName` is accepted for API compatibility with callers that resolve policy per target repo, but the
 * resolver intentionally does not fetch or trust target-repository AMS policy content.
 */
export async function resolveAmsPolicy(repoFullName, options = {}) {
    void repoFullName;
    const resolved = normalizeOptions(options);
    const localContent = readLocalAmsPolicyContent(resolved);
    if (localContent !== null) {
        const parsed = parseAmsPolicySpecContent(localContent);
        return { spec: parsed.spec, source: "local", warnings: parsed.warnings };
    }
    return { spec: DEFAULT_AMS_POLICY_SPEC, source: "default", warnings: [] };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW1zLXBvbGljeS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImFtcy1wb2xpY3kudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxFQUFFLFVBQVUsRUFBRSxZQUFZLEVBQUUsTUFBTSxTQUFTLENBQUM7QUFFbkQsT0FBTyxFQUFFLHVCQUF1QixFQUFFLHlCQUF5QixFQUFFLE1BQU0sa0JBQWtCLENBQUM7QUFDdEYsT0FBTyxFQUFFLHVCQUF1QixFQUFFLE1BQU0sa0JBQWtCLENBQUM7QUFFM0QsaUdBQWlHO0FBQ2pHLG1HQUFtRztBQUNuRyx1QkFBdUI7QUFDdkIsRUFBRTtBQUNGLDBHQUEwRztBQUMxRyx3R0FBd0c7QUFDeEcsNERBQTREO0FBRTVELE1BQU0sbUJBQW1CLEdBQUcsbUJBQW1CLENBQUM7QUF5QmhEOzZGQUM2RjtBQUM3RixNQUFNLFVBQVUsMEJBQTBCLENBQUMsTUFBMEMsT0FBTyxDQUFDLEdBQUc7SUFDOUYsT0FBTyx1QkFBdUIsQ0FBQyxtQkFBbUIsRUFBRSxnQ0FBZ0MsRUFBRSxHQUFHLENBQUMsQ0FBQztBQUM3RixDQUFDO0FBRUQsU0FBUyxnQkFBZ0IsQ0FBQyxVQUE0QixFQUFFO0lBQ3RELE9BQU87UUFDTCxZQUFZLEVBQUUsT0FBTyxDQUFDLFlBQVksSUFBSSxZQUFZO1FBQ2xELFVBQVUsRUFBRSxPQUFPLENBQUMsVUFBVSxJQUFJLFVBQVU7UUFDNUMsR0FBRyxFQUFFLE9BQU8sQ0FBQyxHQUFHLElBQUksT0FBTyxDQUFDLEdBQUc7S0FDaEMsQ0FBQztBQUNKLENBQUM7QUFFRDt1RkFDdUY7QUFDdkYsU0FBUyx5QkFBeUIsQ0FBQyxRQUFvQztJQUNyRSxNQUFNLElBQUksR0FBRywwQkFBMEIsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDdEQsSUFBSSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDO1FBQUUsT0FBTyxJQUFJLENBQUM7SUFDNUMsSUFBSSxDQUFDO1FBQ0gsT0FBTyxRQUFRLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztJQUM3QyxDQUFDO0lBQUMsTUFBTSxDQUFDO1FBQ1AsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0FBQ0gsQ0FBQztBQUVEOzs7Ozs7OztHQVFHO0FBQ0gsTUFBTSxDQUFDLEtBQUssVUFBVSxnQkFBZ0IsQ0FDcEMsWUFBb0IsRUFDcEIsVUFBNEIsRUFBRTtJQUU5QixLQUFLLFlBQVksQ0FBQztJQUNsQixNQUFNLFFBQVEsR0FBRyxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUUzQyxNQUFNLFlBQVksR0FBRyx5QkFBeUIsQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUN6RCxJQUFJLFlBQVksS0FBSyxJQUFJLEVBQUUsQ0FBQztRQUMxQixNQUFNLE1BQU0sR0FBRyx5QkFBeUIsQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUN2RCxPQUFPLEVBQUUsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsTUFBTSxDQUFDLFFBQVEsRUFBRSxDQUFDO0lBQzNFLENBQUM7SUFFRCxPQUFPLEVBQUUsSUFBSSxFQUFFLHVCQUF1QixFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFFLEVBQUUsRUFBRSxDQUFDO0FBQzVFLENBQUMifQ==