import { describe, expect, it } from "vitest";
import { installationInAccessScope, scopeInstallationsAndHealth } from "../../src/api/installation-self-service";
import type { ControlPanelAccessScope } from "../../src/services/control-panel-roles";

const scope = (overrides: Partial<ControlPanelAccessScope> = {}): ControlPanelAccessScope => ({
  operator: false,
  repositoryFullNames: [],
  installationIds: [10],
  accountLogins: ["Acme"],
  ...overrides,
});

describe("installation self-service scope helpers (#7661)", () => {
  it("matches by installation id or account login, and rejects nullish/empty logins", () => {
    expect(installationInAccessScope(scope(), 10, null)).toBe(true);
    expect(installationInAccessScope(scope(), 99, "acme")).toBe(true);
    expect(installationInAccessScope(scope(), 99, "other")).toBe(false);
    expect(installationInAccessScope(scope(), 99, null)).toBe(false);
    expect(installationInAccessScope(scope(), 99, undefined)).toBe(false);
    expect(installationInAccessScope(scope(), 99, "")).toBe(false);
  });

  it("passes lists through unchanged when scope is null, and filters when scoped", () => {
    const installations = [
      { id: 10, accountLogin: "Acme" },
      { id: 20, accountLogin: "Victim" },
      { id: 30, accountLogin: "acme" },
    ];
    const health = [
      { installationId: 10, accountLogin: "Acme" },
      { installationId: 20, accountLogin: "Victim" },
      { installationId: 40, accountLogin: "Acme" },
    ];

    expect(scopeInstallationsAndHealth(installations, health, null)).toEqual({ installations, health });

    const filtered = scopeInstallationsAndHealth(installations, health, scope());
    expect(filtered.installations.map((row) => row.id)).toEqual([10, 30]);
    expect(filtered.health.map((row) => row.installationId)).toEqual([10, 40]);
  });
});
