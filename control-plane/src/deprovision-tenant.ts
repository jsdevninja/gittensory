// `deprovisionTenant` orchestration (#7524 / #7180). Reverse of provision: revoke secrets → destroy DB →
// destroy container. Destroy of a nonexistent tenant is idempotent (`alreadyAbsent: true`).
//
// #7539 follow-up: when `provisioned` handles are omitted (e.g. caller restarted and lost in-memory IDs),
// still ask the driver to tear down by tenant — never return `{ state: "gone" }` without driver calls.

import { ControlPlaneError, isControlPlaneError } from "./errors.js";
import type { TenantProvisioningDriver } from "./tenant-provisioning-driver.js";
import type { DeprovisionedTenant, SecretsHandle, TenantRef } from "./types.js";
import { assertValidTenantRef } from "./validate-tenant.js";

export type DeprovisionTenantOptions = {
  driver: TenantProvisioningDriver;
  /**
   * Optional handles from a prior `provisionTenant` result. When omitted, the driver is asked to
   * destroy/revoke by tenant with absent-tolerant calls (IDs left undefined so the driver resolves
   * whatever it still has recorded for that tenant).
   */
  provisioned?:
    | {
        containerId: string;
        databaseId: string;
        secrets: SecretsHandle;
      }
    | undefined;
};

/**
 * Tear down a hosted tenant through the driver seam. Idempotent when the tenant is already gone.
 * Always invokes revoke/destroy on the driver — even when `provisioned` is omitted.
 */
export async function deprovisionTenant(
  tenantInput: TenantRef,
  options: DeprovisionTenantOptions,
): Promise<DeprovisionedTenant> {
  const tenant = assertValidTenantRef(tenantInput);
  const { driver, provisioned } = options;

  let secretsResult: "revoked" | "absent";
  let databaseResult: "destroyed" | "absent";
  let containerResult: "destroyed" | "absent";

  try {
    secretsResult = await driver.revokeSecrets(tenant, provisioned?.secrets.enrollId);
  } catch (error) {
    if (isControlPlaneError(error)) throw error;
    throw new ControlPlaneError(
      "secrets_revoke_failed",
      `Secrets revoke failed for ${tenant.product}/${tenant.tenantId}`,
      error,
    );
  }
  try {
    databaseResult = await driver.destroyDatabase(tenant, provisioned?.databaseId);
  } catch (error) {
    if (isControlPlaneError(error)) throw error;
    throw new ControlPlaneError(
      "database_destroy_failed",
      `Database destroy failed for ${tenant.product}/${tenant.tenantId}`,
      error,
    );
  }
  try {
    containerResult = await driver.destroyContainer(tenant, provisioned?.containerId);
  } catch (error) {
    if (isControlPlaneError(error)) throw error;
    throw new ControlPlaneError(
      "container_destroy_failed",
      `Container destroy failed for ${tenant.product}/${tenant.tenantId}`,
      error,
    );
  }

  const alreadyAbsent =
    secretsResult === "absent" && databaseResult === "absent" && containerResult === "absent";

  return { tenant, state: "gone", alreadyAbsent };
}
