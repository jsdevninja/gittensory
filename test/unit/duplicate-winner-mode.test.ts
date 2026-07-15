import { describe, expect, it } from "vitest";
import { isDuplicateWinnerEnabledGlobally, resolveDuplicateWinnerEnabled } from "../../src/settings/duplicate-winner-mode";

describe("isDuplicateWinnerEnabledGlobally", () => {
  it("defaults OFF when unset", () => {
    expect(isDuplicateWinnerEnabledGlobally({})).toBe(false);
    expect(isDuplicateWinnerEnabledGlobally({ LOOPOVER_DUPLICATE_WINNER: undefined })).toBe(false);
    expect(isDuplicateWinnerEnabledGlobally({ LOOPOVER_DUPLICATE_WINNER: "" })).toBe(false);
  });

  it("is ON only for the exact string \"true\"", () => {
    expect(isDuplicateWinnerEnabledGlobally({ LOOPOVER_DUPLICATE_WINNER: "true" })).toBe(true);
  });

  it("stays OFF for any other value, including truthy-looking ones", () => {
    for (const value of ["1", "yes", "on", "True", "TRUE", " true "]) {
      expect(isDuplicateWinnerEnabledGlobally({ LOOPOVER_DUPLICATE_WINNER: value })).toBe(false);
    }
  });
});

describe("resolveDuplicateWinnerEnabled", () => {
  it("inherit defers to the global default in both directions", () => {
    expect(resolveDuplicateWinnerEnabled(true, "inherit")).toBe(true);
    expect(resolveDuplicateWinnerEnabled(false, "inherit")).toBe(false);
  });

  it("null/undefined mode behaves the same as inherit", () => {
    expect(resolveDuplicateWinnerEnabled(true, null)).toBe(true);
    expect(resolveDuplicateWinnerEnabled(false, undefined)).toBe(false);
  });

  it("off fully overrides a globally-ON default", () => {
    expect(resolveDuplicateWinnerEnabled(true, "off")).toBe(false);
  });

  it("enabled fully overrides a globally-OFF default (symmetric)", () => {
    expect(resolveDuplicateWinnerEnabled(false, "enabled")).toBe(true);
  });
});
