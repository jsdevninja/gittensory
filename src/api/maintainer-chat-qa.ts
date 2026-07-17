/** Pure helpers for the maintainer Chat Q&A dashboard surface (#6489). Kept tiny and side-effect-free
 *  so unit tests can cover every branch without standing up the full Hono app. */

export function isRepoChatQaEnabled(settings: {
  advisoryAiRouting?: { chatQa?: boolean | undefined } | null | undefined;
}): boolean {
  return settings.advisoryAiRouting?.chatQa === true;
}

export function resolveChatQaRateLimit(settings: {
  commandRateLimitPolicy?: "off" | "hold" | undefined;
  commandRateLimitAiMaxPerWindow?: number | undefined;
  commandRateLimitWindowHours?: number | undefined;
}): { policy: "off" | "hold"; maxPerWindow: number; windowHours: number } {
  return {
    policy: settings.commandRateLimitPolicy ?? "off",
    maxPerWindow: settings.commandRateLimitAiMaxPerWindow ?? 5,
    windowHours: settings.commandRateLimitWindowHours ?? 24,
  };
}

export function resolveChatQaActor(identity: { actor?: string | undefined } | null | undefined): string {
  return identity?.actor ?? "maintainer";
}

export function resolveChatQaGroundingLogin(authorLogin: string | null | undefined, actor: string): string {
  return authorLogin ?? actor;
}
