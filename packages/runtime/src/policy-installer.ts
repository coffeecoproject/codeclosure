import { z } from 'zod';

import {
  auditEventId,
  decodePolicyBundle,
  decodePolicyBundleDefinition,
  isoTimestamp,
  policyBundleProjection,
  sha256Digest,
  type PolicyBundle,
  type PolicyBundleDefinition,
} from '@codeclosure/domain';

import type {
  Clock,
  DigestProvider,
  IdGenerator,
  InstalledPolicyBundle,
  PolicyInstallResult,
  WorkerControlStore,
} from './ports.js';

export interface PolicyInstallerDependencies {
  readonly store: Pick<WorkerControlStore, 'installPolicyBundle'>;
  readonly clock: Clock;
  readonly ids: Pick<IdGenerator, 'nextAuditEventId'>;
  readonly digests: DigestProvider;
}

export interface PolicyInstaller {
  installPolicyBundle(definition: unknown): PolicyInstallResult;
}

const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: 'Expected a non-blank string',
});
const installedPolicyBundleSchema = z
  .object({ bundle: z.unknown(), installedAt: z.string() })
  .strict();
const policyInstallResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('INSTALLED'),
      value: installedPolicyBundleSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('EXISTING'),
      value: installedPolicyBundleSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('POLICY_CONFLICT'),
      message: nonBlankStringSchema,
    })
    .strict(),
]);

function decodeInstalledPolicyBundle(value: unknown): InstalledPolicyBundle {
  const parsed = installedPolicyBundleSchema.parse(value);
  return Object.freeze({
    bundle: decodePolicyBundle(parsed.bundle),
    installedAt: isoTimestamp(parsed.installedAt),
  });
}

function assertInstalledPolicyMatches(
  expected: PolicyBundle,
  installed: InstalledPolicyBundle,
  digests: DigestProvider,
): void {
  const persistedDigest = sha256Digest(digests.digest(policyBundleProjection(installed.bundle)));
  if (
    installed.bundle.id !== expected.id ||
    installed.bundle.digest !== expected.digest ||
    persistedDigest !== expected.digest
  ) {
    throw new TypeError(
      'Policy Store returned authority that differs from the installed definition',
    );
  }
}

class RuntimePolicyInstaller implements PolicyInstaller {
  readonly #dependencies: PolicyInstallerDependencies;

  public constructor(dependencies: PolicyInstallerDependencies) {
    this.#dependencies = dependencies;
  }

  public installPolicyBundle(rawDefinition: unknown): PolicyInstallResult {
    const definition: PolicyBundleDefinition = decodePolicyBundleDefinition(rawDefinition);
    const digest = sha256Digest(
      this.#dependencies.digests.digest(policyBundleProjection(definition)),
    );
    const bundle = decodePolicyBundle({ ...definition, digest });
    const installedAt = isoTimestamp(this.#dependencies.clock.now());
    const auditIdentity = auditEventId(this.#dependencies.ids.nextAuditEventId());
    const rawResult: unknown = this.#dependencies.store.installPolicyBundle({
      bundle,
      installedAt,
      auditEventId: auditIdentity,
      payloadDigest: digest,
    });
    const parsed = policyInstallResultSchema.parse(rawResult);
    if (parsed.status === 'INSTALLED' || parsed.status === 'EXISTING') {
      const value = decodeInstalledPolicyBundle(parsed.value);
      assertInstalledPolicyMatches(bundle, value, this.#dependencies.digests);
      if (parsed.status === 'INSTALLED' && value.installedAt !== installedAt) {
        throw new TypeError('Policy Store changed the Runtime-owned installation time');
      }
      return Object.freeze({ status: parsed.status, value });
    }
    return Object.freeze({ status: parsed.status, message: parsed.message });
  }
}

export function createPolicyInstaller(dependencies: PolicyInstallerDependencies): PolicyInstaller {
  return new RuntimePolicyInstaller(dependencies);
}
