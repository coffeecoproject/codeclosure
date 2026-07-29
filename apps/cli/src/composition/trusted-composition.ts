import {
  CanonicalJsonSha256DigestProvider,
  MinimalContextCompiler,
  Rfc8785Canonicalizer,
  createCodeClosureApplication,
  createExecutionProfileInstaller,
  createM1PolicyBundleDefinition,
  createPolicyInstaller,
  type CodeClosureApplication,
  type StartupRecoverySummary,
} from '@codeclosure/runtime';
import {
  CryptographicIdentityGenerator,
  SystemUtcClock,
  createM1DeterministicPhaseGuardEvaluator,
  createRecoveryCoordinator,
  createWorkflowDriver,
} from '@codeclosure/runtime/composition';

import { ProtectedPathKind, resolveCodeClosureDataHomePath } from './data-home.js';
import {
  installM1RuntimeProfiles,
  parseM1RuntimeProfileName,
  type M1RuntimeProfileScenarioControl,
} from './m1-runtime-profiles.js';
import { createNormalizedProjectPathPort } from './project-paths.js';
import { M1LocalRecoveryInspector } from './recovery-inspector.js';
import { openCliSqliteAuthority, type OpenCliSqliteAuthorityOptions } from './sqlite-authority.js';

export interface CreateCliCompositionOptions extends OpenCliSqliteAuthorityOptions {
  /** One of the closed M1 Fake profile names; defaults to happy-path. */
  readonly startProfileName?: string;
}

export interface CliComposition {
  readonly application: CodeClosureApplication;
  readonly startupRecovery: StartupRecoverySummary;
  close(): void;
}

export interface TrustedCliComposition extends CliComposition {
  readonly scenarioControl: M1RuntimeProfileScenarioControl;
  readonly proofObservation: ReturnType<typeof installM1RuntimeProfiles>['proofObservation'];
}

export interface CreateCliInvocationCompositionOptions {
  readonly platform: NodeJS.Platform;
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** Exact normalized project path known to this invocation, when applicable. */
  readonly projectPath?: string;
  readonly startProfileName?: string;
}

/** Creates one fresh application-command identity without exposing the generator. */
export function createCliCommandId(): ReturnType<CryptographicIdentityGenerator['nextCommandId']> {
  return new CryptographicIdentityGenerator().nextCommandId();
}

/** Validates the closed M1 fixture alias without exporting FakeWorker registry types. */
export function validateCliStartProfileName(value: string): string {
  return parseM1RuntimeProfileName(value);
}

/**
 * Production entry-point wrapper. Filesystem and data-home capabilities remain
 * inside trusted composition while handlers receive only the narrow facade.
 */
export function createCliInvocationComposition(
  options: CreateCliInvocationCompositionOptions,
): CliComposition {
  const protectedPaths =
    options.projectPath === undefined
      ? Object.freeze([])
      : Object.freeze([
          Object.freeze({ kind: ProtectedPathKind.PROJECT, path: options.projectPath }),
        ]);
  return createCliComposition({
    dataHomePath: resolveCodeClosureDataHomePath({
      platform: options.platform,
      environment: options.environment,
    }),
    protectedPaths,
    allowedProjectPaths:
      options.projectPath === undefined ? Object.freeze([]) : Object.freeze([options.projectPath]),
    ...(options.startProfileName === undefined
      ? {}
      : { startProfileName: options.startProfileName }),
  });
}

/** Internal factory retained inside the trusted composition directory. */
export function createTrustedCliComposition(
  options: CreateCliCompositionOptions,
  driverMaxOperations?: number,
): TrustedCliComposition {
  const startProfileName = parseM1RuntimeProfileName(options.startProfileName);
  const store = openCliSqliteAuthority(options);

  try {
    const clock = new SystemUtcClock();
    const ids = new CryptographicIdentityGenerator();
    const digests = new CanonicalJsonSha256DigestProvider();

    const policyResult = createPolicyInstaller({ store, clock, ids, digests }).installPolicyBundle(
      createM1PolicyBundleDefinition(digests),
    );
    if (policyResult.status === 'POLICY_CONFLICT') {
      throw new TypeError('Built-in M1 Policy conflicts with retained authority');
    }

    const profiles = installM1RuntimeProfiles(
      createExecutionProfileInstaller({ store, clock, ids, digests }),
      startProfileName,
    );
    const contextFactory = new MinimalContextCompiler({
      compilerVersion: 'm1-context-compiler-v1',
      maxPackageBytes: 64 * 1024,
      canonicalizer: new Rfc8785Canonicalizer(),
      digests,
    });
    const phaseGuards = createM1DeterministicPhaseGuardEvaluator();
    const recovery = createRecoveryCoordinator({
      store,
      clock,
      ids,
      digests,
      policyBundleId: policyResult.value.bundle.id,
      policyBundleDigest: policyResult.value.bundle.digest,
      inspector: new M1LocalRecoveryInspector(digests),
      inspectorVersion: 'm1-local-recovery-inspector-v1',
      recoveryPolicyVersion: 'm1-exact-same-phase-v1',
    });

    // No command capability is published until retained active work is reconciled.
    const startupRecovery = recovery.recoverOnStartup();
    const execution = createWorkflowDriver({
      store,
      clock,
      ids,
      digests,
      contextFactory,
      policyBundleId: policyResult.value.bundle.id,
      policyBundleDigest: policyResult.value.bundle.digest,
      phaseGuards,
      recovery,
      startProfile: profiles.startProfile,
      profiles: profiles.resolver,
      ...(driverMaxOperations === undefined ? {} : { maxOperations: driverMaxOperations }),
    });
    const application = createCodeClosureApplication({
      store,
      clock,
      creationIds: ids,
      digests,
      projectPaths: createNormalizedProjectPathPort(),
      execution,
    });
    let closed = false;

    return Object.freeze({
      application,
      startupRecovery,
      scenarioControl: profiles.scenarioControl,
      proofObservation: profiles.proofObservation,
      close: (): void => {
        if (!closed) {
          store.close();
          closed = true;
        }
      },
    });
  } catch (error) {
    try {
      store.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        'CLI composition failed and its SQLite authority could not be closed cleanly',
        { cause: closeError },
      );
    }
    throw error;
  }
}

/**
 * Sole trusted M1 composition root. Raw Store, Runtime coordinator, and Fake
 * scenario controls remain captured here and are never returned to adapters.
 */
export function createCliComposition(options: CreateCliCompositionOptions): CliComposition {
  const trusted = createTrustedCliComposition(options);
  return Object.freeze({
    application: trusted.application,
    startupRecovery: trusted.startupRecovery,
    close: (): void => trusted.close(),
  });
}
