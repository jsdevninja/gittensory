import { listNotificationDeliveriesForRecipient } from "../db/repositories";

export type ContributorPrOutcome = {
  repoFullName: string;
  pullNumber: number | null;
  outcome: "merged";
  attribution: string;
  deeplink: string;
  recordedAt: string;
};

export type ContributorPrOutcomes = {
  login: string;
  count: number;
  summary: string;
  outcomes: ContributorPrOutcome[];
};

/**
 * Post-merge outcome history for a contributor — the payload behind `loopover_pr_outcome`
 * and `GET /v1/contributors/:login/pr-outcomes`. Sourced from notification deliveries with
 * `eventType: "pull_request_merged"` (public-safe attribution only; no reward/wallet fields).
 */
export async function buildContributorPrOutcomes(env: Env, login: string, limit?: number): Promise<ContributorPrOutcomes> {
  const deliveries = await listNotificationDeliveriesForRecipient(env, login, {
    eventType: "pull_request_merged",
    limit: limit ?? 50,
  });
  const outcomes: ContributorPrOutcome[] = deliveries.map((delivery) => ({
    repoFullName: delivery.repoFullName,
    pullNumber: delivery.pullNumber,
    outcome: "merged" as const,
    attribution: delivery.body,
    deeplink: delivery.deeplink,
    recordedAt: delivery.createdAt,
  }));
  const normalizedLogin = login.toLowerCase();
  return {
    login: normalizedLogin,
    count: outcomes.length,
    summary: `LoopOver post-merge outcomes for ${login}: ${outcomes.length} merged PR(s).`,
    outcomes,
  };
}
