import { describe, expect, it } from "vitest";
import { isOpenPrFileCollisionEnabledGlobally, resolveOpenPrFileCollisionEnabled } from "../../src/settings/open-pr-file-collision-mode";

describe("isOpenPrFileCollisionEnabledGlobally", () => {
  it("defaults OFF when unset", () => {
    expect(isOpenPrFileCollisionEnabledGlobally({})).toBe(false);
    expect(isOpenPrFileCollisionEnabledGlobally({ LOOPOVER_OPEN_PR_FILE_COLLISION: undefined })).toBe(false);
    expect(isOpenPrFileCollisionEnabledGlobally({ LOOPOVER_OPEN_PR_FILE_COLLISION: "" })).toBe(false);
  });

  it("is ON only for the exact string \"true\"", () => {
    expect(isOpenPrFileCollisionEnabledGlobally({ LOOPOVER_OPEN_PR_FILE_COLLISION: "true" })).toBe(true);
  });

  it("stays OFF for any other value, including truthy-looking ones", () => {
    for (const value of ["1", "yes", "on", "True", "TRUE", " true "]) {
      expect(isOpenPrFileCollisionEnabledGlobally({ LOOPOVER_OPEN_PR_FILE_COLLISION: value })).toBe(false);
    }
  });
});

describe("resolveOpenPrFileCollisionEnabled", () => {
  it("inherit defers to the global default in both directions", () => {
    expect(resolveOpenPrFileCollisionEnabled(true, "inherit")).toBe(true);
    expect(resolveOpenPrFileCollisionEnabled(false, "inherit")).toBe(false);
  });

  it("null/undefined mode behaves the same as inherit", () => {
    expect(resolveOpenPrFileCollisionEnabled(true, null)).toBe(true);
    expect(resolveOpenPrFileCollisionEnabled(false, undefined)).toBe(false);
  });

  it("off fully overrides a globally-ON default", () => {
    expect(resolveOpenPrFileCollisionEnabled(true, "off")).toBe(false);
  });

  it("enabled fully overrides a globally-OFF default (symmetric)", () => {
    expect(resolveOpenPrFileCollisionEnabled(false, "enabled")).toBe(true);
  });
});
