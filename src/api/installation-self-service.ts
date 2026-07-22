import type { ControlPanelAccessScope } from "../services/control-panel-roles";

/** #7661: whether an installation id/account is inside a control-panel access scope. */
export function installationInAccessScope(scope: ControlPanelAccessScope, installationId: number, accountLogin?: string | null): boolean {
  if (scope.installationIds.includes(installationId)) return true;
  if (!accountLogin) return false;
  return scope.accountLogins.some((login) => login.toLowerCase() === accountLogin.toLowerCase());
}

/** #7661: filter fleet lists down to the caller's tenant scope (null scope = unfiltered). */
export function scopeInstallationsAndHealth<TInstallation extends { id: number; accountLogin: string }, THealth extends { installationId: number; accountLogin: string }>(
  allInstallations: TInstallation[],
  allHealth: THealth[],
  scope: ControlPanelAccessScope | null,
): { installations: TInstallation[]; health: THealth[] } {
  if (!scope) return { installations: allInstallations, health: allHealth };
  return {
    installations: allInstallations.filter((installation) => installationInAccessScope(scope, installation.id, installation.accountLogin)),
    health: allHealth.filter((record) => installationInAccessScope(scope, record.installationId, record.accountLogin)),
  };
}
