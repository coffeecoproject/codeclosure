import { z } from 'zod';

import {
  auditEventId,
  decodeExecutionProfile,
  decodeExecutionProfileDefinition,
  executionProfileProjection,
  isoTimestamp,
  sha256Digest,
  type ExecutionProfile,
  type ExecutionProfileDefinition,
} from '@codeclosure/domain';

import type {
  Clock,
  DigestProvider,
  ExecutionProfileInstallResult,
  IdGenerator,
  InstalledExecutionProfile,
  WorkerControlStore,
} from './ports.js';

export interface ExecutionProfileInstallerDependencies {
  readonly store: Pick<WorkerControlStore, 'installExecutionProfile'>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly digests: DigestProvider;
}

export interface ExecutionProfileInstaller {
  installExecutionProfile(definition: unknown): ExecutionProfileInstallResult;
}

const installedExecutionProfileSchema = z
  .object({
    profile: z.unknown(),
    installedAt: z.string(),
  })
  .strict();

const executionProfileInstallResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('INSTALLED'), value: installedExecutionProfileSchema }).strict(),
  z.object({ status: z.literal('EXISTING'), value: installedExecutionProfileSchema }).strict(),
  z.object({ status: z.literal('PROFILE_CONFLICT'), message: z.string() }).strict(),
]);

function decodeInstalledExecutionProfile(value: unknown): InstalledExecutionProfile {
  const parsed = installedExecutionProfileSchema.parse(value);
  return Object.freeze({
    profile: decodeExecutionProfile(parsed.profile),
    installedAt: isoTimestamp(parsed.installedAt),
  });
}

function assertInstalledProfileMatches(
  expected: ExecutionProfile,
  installed: InstalledExecutionProfile,
  digests: DigestProvider,
): void {
  const expectedDigest = sha256Digest(digests.digest(executionProfileProjection(expected)));
  if (
    installed.profile.id !== expected.id ||
    installed.profile.digest !== expected.digest ||
    installed.profile.digest !== expectedDigest ||
    JSON.stringify(executionProfileProjection(installed.profile)) !==
      JSON.stringify(executionProfileProjection(expected))
  ) {
    throw new TypeError(
      'Execution Profile Store returned authority that differs from the installed definition',
    );
  }
}

class RuntimeExecutionProfileInstaller implements ExecutionProfileInstaller {
  readonly #dependencies: ExecutionProfileInstallerDependencies;

  public constructor(dependencies: ExecutionProfileInstallerDependencies) {
    this.#dependencies = dependencies;
  }

  public installExecutionProfile(rawDefinition: unknown): ExecutionProfileInstallResult {
    const definition: ExecutionProfileDefinition = decodeExecutionProfileDefinition(rawDefinition);
    const digest = sha256Digest(
      this.#dependencies.digests.digest(executionProfileProjection(definition)),
    );
    const profile = decodeExecutionProfile({ ...definition, digest });
    const installedAt = isoTimestamp(this.#dependencies.clock.now());
    const rawResult: unknown = this.#dependencies.store.installExecutionProfile({
      profile,
      installedAt,
      auditEventId: auditEventId(this.#dependencies.ids.nextAuditEventId()),
      payloadDigest: digest,
    });
    const parsed = executionProfileInstallResultSchema.parse(rawResult);
    if (parsed.status === 'INSTALLED' || parsed.status === 'EXISTING') {
      const value = decodeInstalledExecutionProfile(parsed.value);
      assertInstalledProfileMatches(profile, value, this.#dependencies.digests);
      if (parsed.status === 'INSTALLED' && value.installedAt !== installedAt) {
        throw new TypeError('Execution Profile Store changed the Runtime-owned installation time');
      }
      return Object.freeze({ status: parsed.status, value });
    }
    return Object.freeze({ status: parsed.status, message: parsed.message });
  }
}

export function createExecutionProfileInstaller(
  dependencies: ExecutionProfileInstallerDependencies,
): ExecutionProfileInstaller {
  return new RuntimeExecutionProfileInstaller(dependencies);
}
