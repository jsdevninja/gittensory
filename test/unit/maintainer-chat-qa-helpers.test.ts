import { describe, expect, it } from "vitest";

import {
  isRepoChatQaEnabled,
  resolveChatQaActor,
  resolveChatQaGroundingLogin,
  resolveChatQaRateLimit,
} from "../../src/api/maintainer-chat-qa";

describe("maintainer-chat-qa helpers (#6489)", () => {
  it("isRepoChatQaEnabled requires an explicit true flag", () => {
    expect(isRepoChatQaEnabled({})).toBe(false);
    expect(isRepoChatQaEnabled({ advisoryAiRouting: null })).toBe(false);
    expect(isRepoChatQaEnabled({ advisoryAiRouting: {} })).toBe(false);
    expect(isRepoChatQaEnabled({ advisoryAiRouting: { chatQa: false } })).toBe(false);
    expect(isRepoChatQaEnabled({ advisoryAiRouting: { chatQa: true } })).toBe(true);
  });

  it("resolveChatQaRateLimit applies built-in defaults when fields are omitted", () => {
    expect(resolveChatQaRateLimit({})).toEqual({ policy: "off", maxPerWindow: 5, windowHours: 24 });
    expect(resolveChatQaRateLimit({ commandRateLimitPolicy: "hold", commandRateLimitAiMaxPerWindow: 2, commandRateLimitWindowHours: 12 })).toEqual({
      policy: "hold",
      maxPerWindow: 2,
      windowHours: 12,
    });
  });

  it("resolveChatQaActor falls back to maintainer when identity is missing", () => {
    expect(resolveChatQaActor(null)).toBe("maintainer");
    expect(resolveChatQaActor(undefined)).toBe("maintainer");
    expect(resolveChatQaActor({})).toBe("maintainer");
    expect(resolveChatQaActor({ actor: "api" })).toBe("api");
  });

  it("resolveChatQaGroundingLogin prefers the PR author when present", () => {
    expect(resolveChatQaGroundingLogin("alice", "api")).toBe("alice");
    expect(resolveChatQaGroundingLogin(null, "api")).toBe("api");
    expect(resolveChatQaGroundingLogin(undefined, "api")).toBe("api");
  });
});
