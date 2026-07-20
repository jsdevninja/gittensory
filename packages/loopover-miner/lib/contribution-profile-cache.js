import { CONTRIBUTION_PROFILE_CACHE_TTL_MS, CONTRIBUTION_PROFILE_STORE_TABLE, } from "./contribution-profile.js";
import { normalizeLocalStoreDbPath, openLocalStoreDb, resolveLocalStoreDbPath, } from "./local-store.js";
import { applySchemaMigrations } from "./schema-version.js";
import { CONTRIBUTION_PROFILE_CACHE_PURGE_SPEC, purgeStoreByRepo, } from "./store-maintenance.js";
const defaultDbFileName = "contribution-profile-cache.sqlite3";
let defaultContributionProfileCache = null;
export function resolveContributionProfileCacheDbPath(env = process.env) {
    return resolveLocalStoreDbPath(defaultDbFileName, "LOOPOVER_MINER_CONTRIBUTION_PROFILE_CACHE_DB", env);
}
function normalizeDbPath(dbPath) {
    return normalizeLocalStoreDbPath(dbPath, resolveContributionProfileCacheDbPath(), "invalid_contribution_profile_cache_db_path");
}
function normalizeRepoFullName(repoFullName) {
    if (typeof repoFullName !== "string")
        throw new Error("invalid_repo_full_name");
    const [owner, repo, extra] = repoFullName.trim().split("/");
    if (!owner || !repo || extra !== undefined)
        throw new Error("invalid_repo_full_name");
    return `${owner}/${repo}`;
}
/**
 * Open the 100%-local contribution-profile cache. The DB only lives on this machine (#6797).
 */
export function initContributionProfileCache(dbPath = resolveContributionProfileCacheDbPath()) {
    const resolvedPath = normalizeDbPath(dbPath);
    const db = openLocalStoreDb(resolvedPath);
    db.exec(`
    CREATE TABLE IF NOT EXISTS ${CONTRIBUTION_PROFILE_STORE_TABLE} (
      repo_full_name TEXT PRIMARY KEY,
      profile_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    )
  `);
    // Schema-version convention (#4832): stamp the baseline. No post-baseline migrations for this v1 store yet.
    applySchemaMigrations(db, []);
    const getStatement = db.prepare(`SELECT profile_json, fetched_at FROM ${CONTRIBUTION_PROFILE_STORE_TABLE} WHERE repo_full_name = ?`);
    const putStatement = db.prepare(`
    INSERT INTO ${CONTRIBUTION_PROFILE_STORE_TABLE} (repo_full_name, profile_json, fetched_at)
    VALUES (?, ?, ?)
    ON CONFLICT(repo_full_name) DO UPDATE SET
      profile_json = excluded.profile_json,
      fetched_at = excluded.fetched_at
  `);
    return {
        dbPath: resolvedPath,
        /**
         * Read a cached profile. Returns { profile, fetchedAt, stale } or null when absent. `stale` is true once
         * the row is older than the TTL, so a caller re-extracts. A row whose JSON is unparseable is treated as a
         * miss (fail closed) rather than throwing — a corrupted/hand-edited file must not break discover.
         */
        get(repoFullName, nowMs = Date.now()) {
            const row = getStatement.get(normalizeRepoFullName(repoFullName));
            if (!row)
                return null;
            let profile;
            try {
                profile = JSON.parse(row.profile_json);
            }
            catch {
                return null;
            }
            const fetchedMs = Date.parse(row.fetched_at);
            // An unparseable timestamp fails closed to stale, so a corrupted row is re-extracted rather than trusted.
            const stale = Number.isNaN(fetchedMs) ||
                nowMs - fetchedMs > CONTRIBUTION_PROFILE_CACHE_TTL_MS;
            return { profile, fetchedAt: row.fetched_at, stale };
        },
        /**
         * Cache a profile, stamping it with the current time. The profile's own repoFullName is the key.
         */
        put(profile, nowMs = Date.now()) {
            const repoFullName = normalizeRepoFullName(profile?.repoFullName);
            const fetchedAt = new Date(nowMs).toISOString();
            putStatement.run(repoFullName, JSON.stringify(profile), fetchedAt);
            return { repoFullName, fetchedAt };
        },
        /**
         * Delete the cached profile for one repo (#7091) — the right-to-be-forgotten path `loopover-miner purge`
         * invokes. Returns the number of rows removed (0 or 1, since repo_full_name is the primary key). Reuses
         * store-maintenance.js's identifier-guarded purgeStoreByRepo, exactly like the other repo-scoped stores.
         */
        purgeByRepo(repoFullName) {
            return purgeStoreByRepo(db, CONTRIBUTION_PROFILE_CACHE_PURGE_SPEC, normalizeRepoFullName(repoFullName));
        },
        close() {
            db.close();
        },
    };
}
function getDefaultContributionProfileCache() {
    defaultContributionProfileCache ??= initContributionProfileCache();
    return defaultContributionProfileCache;
}
export function getCachedContributionProfile(repoFullName, nowMs) {
    return getDefaultContributionProfileCache().get(repoFullName, nowMs);
}
export function putCachedContributionProfile(profile, nowMs) {
    return getDefaultContributionProfileCache().put(profile, nowMs);
}
export function closeDefaultContributionProfileCache() {
    if (!defaultContributionProfileCache)
        return;
    defaultContributionProfileCache.close();
    defaultContributionProfileCache = null;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udHJpYnV0aW9uLXByb2ZpbGUtY2FjaGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjb250cmlidXRpb24tcHJvZmlsZS1jYWNoZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFNQSxPQUFPLEVBQ0wsaUNBQWlDLEVBQ2pDLGdDQUFnQyxHQUNqQyxNQUFNLDJCQUEyQixDQUFDO0FBQ25DLE9BQU8sRUFDTCx5QkFBeUIsRUFDekIsZ0JBQWdCLEVBQ2hCLHVCQUF1QixHQUN4QixNQUFNLGtCQUFrQixDQUFDO0FBQzFCLE9BQU8sRUFBRSxxQkFBcUIsRUFBRSxNQUFNLHFCQUFxQixDQUFDO0FBQzVELE9BQU8sRUFDTCxxQ0FBcUMsRUFDckMsZ0JBQWdCLEdBQ2pCLE1BQU0sd0JBQXdCLENBQUM7QUFnQmhDLE1BQU0saUJBQWlCLEdBQUcsb0NBQW9DLENBQUM7QUFDL0QsSUFBSSwrQkFBK0IsR0FBb0MsSUFBSSxDQUFDO0FBRTVFLE1BQU0sVUFBVSxxQ0FBcUMsQ0FBQyxNQUEwQyxPQUFPLENBQUMsR0FBRztJQUN6RyxPQUFPLHVCQUF1QixDQUM1QixpQkFBaUIsRUFDakIsOENBQThDLEVBQzlDLEdBQUcsQ0FDSixDQUFDO0FBQ0osQ0FBQztBQUVELFNBQVMsZUFBZSxDQUFDLE1BQWlDO0lBQ3hELE9BQU8seUJBQXlCLENBQzlCLE1BQU0sRUFDTixxQ0FBcUMsRUFBRSxFQUN2Qyw0Q0FBNEMsQ0FDN0MsQ0FBQztBQUNKLENBQUM7QUFFRCxTQUFTLHFCQUFxQixDQUFDLFlBQXFCO0lBQ2xELElBQUksT0FBTyxZQUFZLEtBQUssUUFBUTtRQUNsQyxNQUFNLElBQUksS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUM7SUFDNUMsTUFBTSxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDLEdBQUcsWUFBWSxDQUFDLElBQUksRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUM1RCxJQUFJLENBQUMsS0FBSyxJQUFJLENB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