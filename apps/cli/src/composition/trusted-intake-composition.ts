import type { DeclaredProjectRef } from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  M25IntakeCoordinator,
  M251IntakePackageCompiler,
  M25IntentAdmissionEngine,
  M25IntentProjectionCompiler,
  MinimalContextCompiler,
  Rfc8785Canonicalizer,
  createCodeClosureApplication,
  createExecutionProfileInstaller,
  createM1PolicyBundleDefinition,
  createM25AdmissionPolicy,
  createM25LocalAdmissionPolicyDefinition,
  createPolicyInstaller,
  type IntakeAssistantPort,
  type IntakeStartCompositionPort,
  type M25IntakeStartupRecoverySummary,
  type StartupRecoverySummary,
} from '@codeclosure/runtime';
import {
  CryptographicIdentityGenerator,
  SystemUtcClock,
  createM1DeterministicPhaseGuardEvaluator,
  createRecoveryCoordinator,
  createWorkflowDriver,
} from '@codeclosure/runtime/composition';

import type { IntakeCliApplication } from '../commands/intake.js';
import { ProtectedPathKind, resolveCodeClosureDataHomePath } from './data-home.js';
import {
  createProductionIntakeAssistant,
  type CreateProductionIntakeAssistantOptions,
  type ProductionIntakeAssistantResource,
} from './intake-assistant-invocation.js';
import { installM1RuntimeProfiles, parseM1RuntimeProfileName } from './m1-runtime-profiles.js';
import { createNormalizedProjectPathPort } from './project-paths.js';
import { M1LocalRecoveryInspector } from './recovery-inspector.js';
import { openCliSqliteAuthority, type OpenCliSqliteAuthorityOptions } from './sqlite-authority.js';

export interface CreateIntakeCliCompositionOptions extends OpenCliSqliteAuthorityOptions {
  readonly assistant: IntakeAssistantPort;
}

export interface IntakeCliComposition {
  readonly application: IntakeCliApplication;
  readonly startupRecovery: StartupRecoverySummary;
  readonly intakeRecovery: M25IntakeStartupRecoverySummary;
  close(): void;
}

export interface CreateIntakeCliInvocationCompositionOptions {
  readonly platform: NodeJS.Platform;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly projectPath?: string;
}

interface CreateIntakeCliInvocationCompositionWithAssistantOptions extends CreateIntakeCliInvocationCompositionOptions {
  readonly createAssistant: (
    options: CreateProductionIntakeAssistantOptions,
  ) => ProductionIntakeAssistantResource;
}

export function createIntakeCliInvocationComposition(
  options: CreateIntakeCliInvocationCompositionOptions,
): IntakeCliComposition {
  return createIntakeCliInvocationCompositionWithAssistant({
    ...options,
    createAssistant: createProductionIntakeAssistant,
  });
}

/** Explicit dependency-injection seam for isolated CLI process tests. */
export function createIntakeCliInvocationCompositionWithAssistant(
  options: CreateIntakeCliInvocationCompositionWithAssistantOptions,
): IntakeCliComposition {
  const dataHomePath = resolveCodeClosureDataHomePath({
    platform: options.platform,
    environment: options.environment,
  });
  const protectedPaths =
    options.projectPath === undefined
      ? Object.freeze([])
      : Object.freeze([
          Object.freeze({ kind: ProtectedPathKind.PROJECT, path: options.projectPath }),
        ]);
  const forbiddenRoots = Object.freeze([
    dataHomePath,
    ...(options.projectPath === undefined ? [] : [options.projectPath]),
  ]);
  const assistant = options.createAssistant({
    environment: options.environment,
    forbiddenRoots,
  });
  try {
    const composition = createIntakeCliComposition({
      dataHomePath,
      protectedPaths,
      allowedProjectPaths:
        options.projectPath === undefined
          ? Object.freeze([])
          : Object.freeze([options.projectPath]),
      assistant: assistant.assistant,
    });
    let closed = false;
    return Object.freeze({
      application: composition.application,
      startupRecovery: composition.startupRecovery,
      intakeRecovery: composition.intakeRecovery,
      close: (): void => {
        if (!closed) {
          closed = true;
          try {
            composition.close();
          } finally {
            try {
              assistant.close();
            } catch {
              // Cleanup cannot replace a committed Intake command disposition.
            }
          }
        }
      },
    });
  } catch (error) {
    try {
      assistant.close();
    } catch {
      // Preserve the owning composition failure rather than a cleanup failure.
    }
    throw error;
  }
}

function declaredProjectRef(
  normalizedPath: string,
  digests: CanonicalJsonSha256DigestProvider,
): DeclaredProjectRef {
  return Object.freeze({
    schemaVersion: 1,
    normalizedPath,
    identityDigest: digests.digest({ normalizedPath }),
  });
}

/**
 * Trusted M2.5 composition root. Store, Admission, Workflow, Start, and
 * assistant capabilities remain captured; CLI handlers receive only the
 * Intake command/read facade.
 */
export function createIntakeCliComposition(
  options: CreateIntakeCliCompositionOptions,
): IntakeCliComposition {
  const store = openCliSqliteAuthority(options);
  try {
    const clock = new SystemUtcClock();
    const ids = new CryptographicIdentityGenerator();
    const digests = new CanonicalJsonSha256DigestProvider();
    const canonicalizer = new Rfc8785Canonicalizer();

    const intentPolicy = createM25AdmissionPolicy(
      createM25LocalAdmissionPolicyDefinition(),
      digests,
    );
    const intentPolicyInstall = store.installIntentAdmissionPolicy({
      policy: intentPolicy,
      installedAt: clock.now(),
      auditEventId: ids.nextAuditEventId(),
      payloadDigest: intentPolicy.digest,
    });
    if (intentPolicyInstall.status === 'POLICY_CONFLICT') {
      throw new TypeError(
        'Built-in M2.5 Intent Admission Policy conflicts with retained authority',
      );
    }

    const workflowPolicy = createPolicyInstaller({
      store,
      clock,
      ids,
      digests,
    }).installPolicyBundle(createM1PolicyBundleDefinition(digests));
    if (workflowPolicy.status === 'POLICY_CONFLICT') {
      throw new TypeError('Built-in M1 Policy conflicts with retained authority');
    }
    const profiles = installM1RuntimeProfiles(
      createExecutionProfileInstaller({ store, clock, ids, digests }),
      parseM1RuntimeProfileName(undefined),
    );
    const installedStartProfile = store.getExecutionProfile(profiles.startProfile.profileId);
    if (installedStartProfile?.profile.digest !== profiles.startProfile.profileDigest) {
      throw new TypeError('Built-in M1 Start profile is unavailable after installation');
    }

    const contextFactory = new MinimalContextCompiler({
      compilerVersion: 'm1-context-compiler-v1',
      maxPackageBytes: 64 * 1024,
      canonicalizer,
      digests,
    });
    const phaseGuards = createM1DeterministicPhaseGuardEvaluator();
    const recovery = createRecoveryCoordinator({
      store,
      clock,
      ids,
      digests,
      policyBundleId: workflowPolicy.value.bundle.id,
      policyBundleDigest: workflowPolicy.value.bundle.digest,
      inspector: new M1LocalRecoveryInspector(digests),
      inspectorVersion: 'm1-local-recovery-inspector-v1',
      recoveryPolicyVersion: 'm1-exact-same-phase-v1',
    });
    const startupRecovery = recovery.recoverOnStartup();
    const execution = createWorkflowDriver({
      store,
      clock,
      ids,
      digests,
      contextFactory,
      policyBundleId: workflowPolicy.value.bundle.id,
      policyBundleDigest: workflowPolicy.value.bundle.digest,
      phaseGuards,
      recovery,
      startProfile: profiles.startProfile,
      profiles: profiles.resolver,
    });
    const workflowApplication = createCodeClosureApplication({
      store,
      clock,
      creationIds: ids,
      digests,
      projectPaths: createNormalizedProjectPathPort(),
      execution,
    });
    const startComposition: IntakeStartCompositionPort = Object.freeze({
      startGoal: (input: Parameters<IntakeStartCompositionPort['startGoal']>[0]) =>
        workflowApplication.startGoal(input),
      getProcessedCommand: (
        commandId: Parameters<IntakeStartCompositionPort['getProcessedCommand']>[0],
      ) => store.getProcessedCommand(commandId),
      getWorkflow: (workflowId: Parameters<IntakeStartCompositionPort['getWorkflow']>[0]) =>
        store.getWorkflow(workflowId),
      getExecutionProfileBinding: (
        workflowId: Parameters<IntakeStartCompositionPort['getExecutionProfileBinding']>[0],
      ) => store.getExecutionProfileBinding(workflowId),
      getWorkflowPolicyBinding: (
        workflowId: Parameters<IntakeStartCompositionPort['getWorkflowPolicyBinding']>[0],
      ) => store.getWorkflowPolicyBinding(workflowId),
    });
    const coordinator = new M25IntakeCoordinator({
      store,
      assistant: options.assistant,
      packageCompiler: new M251IntakePackageCompiler({ canonicalizer, digests }),
      projectionCompiler: new M25IntentProjectionCompiler({ canonicalizer, digests }),
      admissionEngine: new M25IntentAdmissionEngine(digests),
      admissionPolicyId: intentPolicy.id,
      governedExecutionPreflight: Object.freeze({
        schemaVersion: 1,
        workflowPolicyId: workflowPolicy.value.bundle.id,
        workflowPolicyVersion: workflowPolicy.value.bundle.version,
        workflowPolicyDigest: workflowPolicy.value.bundle.digest,
        executionProfileId: installedStartProfile.profile.id,
        executionProfileVersion: installedStartProfile.profile.version,
        executionProfileDigest: installedStartProfile.profile.digest,
      }),
      startComposition,
      clock,
      digests,
      ids,
    });
    const intakeRecovery = coordinator.reconcileStartup();
    let closed = false;
    const application = Object.freeze({
      submit: (input) =>
        coordinator.submit({
          commandId: input.commandId,
          interactionAction: input.interactionAction,
          admittedUserContent: input.admittedUserContent,
          ...(input.declaredProjectPath === undefined
            ? {}
            : { declaredProjectRef: declaredProjectRef(input.declaredProjectPath, digests) }),
          ...(input.declaredConstraints === undefined
            ? {}
            : { declaredConstraints: input.declaredConstraints }),
        }),
      clarify: (input) =>
        coordinator.clarify({
          commandId: input.commandId,
          intakeRunId: input.intakeRunId,
          expectedIntakeRunVersion: input.expectedIntakeRunVersion,
          clarificationQuestionId: input.clarificationQuestionId,
          answer: input.answer,
          ...(input.declaredProjectPath === undefined
            ? {}
            : { declaredProjectRef: declaredProjectRef(input.declaredProjectPath, digests) }),
        }),
      abandon: (input) => coordinator.abandon(input),
      getStatus: (intakeRunId) => coordinator.getStatus(intakeRunId),
      getAudit: (intakeRunId) => coordinator.getAudit(intakeRunId),
    } satisfies IntakeCliApplication);

    return Object.freeze({
      application,
      startupRecovery,
      intakeRecovery,
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
        'Intake CLI composition failed and its SQLite authority could not be closed cleanly',
        { cause: closeError },
      );
    }
    throw error;
  }
}
