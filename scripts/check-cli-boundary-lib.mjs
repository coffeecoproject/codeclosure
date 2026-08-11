import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

const PRIVILEGED_PACKAGE_ROOTS = new Map([
  [
    '@codeclosure/adapter-codex',
    'CLI adapters must not import the raw Codex Worker adapter capability.',
  ],
  [
    '@codeclosure/adapter-codex-intake',
    'CLI adapters must not import the raw Codex Intake adapter capability.',
  ],
  [
    '@codeclosure/codex-app-server-client/testing',
    'CLI adapters must not import the Codex App Server fixture-launch capability.',
  ],
  [
    '@codeclosure/codex-app-server-client',
    'CLI adapters must not import the raw Codex App Server client capability.',
  ],
  [
    '@codeclosure/domain',
    'CLI adapters must receive compiled views rather than construct Domain authority.',
  ],
  [
    '@codeclosure/runtime/composition',
    'CLI adapters must receive the public application facade, not construct Runtime coordinators.',
  ],
  ['@codeclosure/store-sqlite', 'CLI adapters must not import the control Store.'],
  ['@codeclosure/testing', 'CLI adapters must not import test fixtures or fake capabilities.'],
  [
    '@codeclosure/verification-local',
    'CLI adapters must not import the raw local verifier capability.',
  ],
  [
    '@codeclosure/workspace-local',
    'CLI adapters must not import the raw Candidate workspace capability.',
  ],
]);

const PUBLIC_ADAPTER_RUNTIME_IMPORTS = new Set([
  'CancelGoalRequest',
  'CodeClosureApplication',
  'CommandError',
  'CommandOutput',
  'CreateGoalRequest',
  'DrivenGoalCommandResult',
  'ExternalFailureCodeView',
  'FailedCommandOutput',
  'GoalAuditEventView',
  'GoalAuditView',
  'GoalDominantBlocker',
  'GoalDominantBlockerCode',
  'GoalNextSafeAction',
  'GoalReadResult',
  'GoalStatusView',
  'AbandonIntakeCommand',
  'ClarifyIntakeCommand',
  'IntakeAuditView',
  'IntakeCoordinatorCommandResult',
  'IntakeStatusView',
  'JsonPrimitive',
  'JsonValue',
  'parseGoalIdentifier',
  'parseClarificationQuestionIdentifier',
  'parseIntakeRunIdentifier',
  'ResumeGoalRequest',
  'RuntimeCommandResult',
  'RuntimeErrorCode',
  'StartGoalRequest',
  'SubmitIntakeCommand',
  'SuccessfulCommandOutput',
  'WorkflowDriveFinalState',
  'WorkflowDriveStopReason',
  'WorkflowDriveSummary',
]);

const TRUSTED_COMPOSITION_STORE_IMPORTS = new Set([
  'openVerifiedSqliteControlStore',
  'SqliteAuthorityIsolationSnapshot',
]);

const TRUSTED_COMPOSITION_TESTING_IMPORTS = new Set([
  'FakeCandidateSource',
  'FakeVerificationRunner',
  'FakeWorker',
  'M1FakeExecutionProfileName',
  'm1FakeExecutionProfileRecipe',
  'm1FakeExecutionProfileRecipes',
]);

const TRUSTED_COMPOSITION_RUNTIME_IMPORTS = new Set([
  'CryptographicIdentityGenerator',
  'SystemUtcClock',
  'createM1DeterministicPhaseGuardEvaluator',
  'createRecoveryCoordinator',
  'createWorkflowDriver',
]);

const RUNTIME_PROFILE_COMPOSITION_IMPORTS = new Set([
  'RuntimeExecutionProfile',
  'RuntimeExecutionProfileResolver',
]);

const M2_CODEX_ADAPTER_IMPORTS = new Set([
  'CODEX_WORKER_CANDIDATE_TRUST_POLICY',
  'CODEX_WORKER_DISABLED_FEATURES',
  'CODEX_WORKER_PROMPT_PROFILE',
  'CODEX_WORKER_PROMPT_TEMPLATE_DIGEST',
  'CodexExecutionProfileDirective',
  'CodexWorkerRequestBinding',
  'createCodexWorkerAdapter',
  'createCodexWorkerDirective',
  'digestCanonical',
]);

const M2_CODEX_CLIENT_IMPORTS = new Set([
  'AppServerProcessLaunch',
  'JsonValue',
  'VerifiedCodexInstallation',
  'createControlledAppServerLaunch',
  'isJsonObject',
  'startAppServerClient',
  'verifyBundledCodexInstallation',
]);

const M25_INTAKE_ADAPTER_IMPORTS = new Set([
  'M251_LIVE_INTAKE_DISABLED_FEATURES',
  'M251_INTAKE_DISABLED_FEATURES',
  'M25_INTAKE_DISABLED_FEATURES',
  'M25_INTAKE_PERMISSION_PROFILE_ID',
  'createCodexIntakeAssistantAdapter',
]);

const M25_INTAKE_CLIENT_IMPORTS = new Set([
  'AppServerProcessLaunch',
  'createControlledAppServerLaunch',
  'verifyBundledCodexInstallation',
]);

const M25_INTAKE_DOMAIN_IMPORTS = new Set(['DeclaredProjectRef']);

const M25_INTAKE_RUNTIME_COMPOSITION_IMPORTS = new Set([
  'CryptographicIdentityGenerator',
  'SystemUtcClock',
  'createM1DeterministicPhaseGuardEvaluator',
  'createRecoveryCoordinator',
  'createWorkflowDriver',
]);

const M2_CODEX_DOMAIN_IMPORTS = new Set([
  'CandidateGenerationState',
  'ExternalBackendCapability',
  'ExternalBackendCapabilityClassification',
  'ExternalBackendCapabilityRecord',
  'ExternalCompactionPolicy',
  'ExternalContinuityPolicy',
  'ExternalExecutionIntent',
  'ExternalExecutionProfileDefinition',
  'ExternalFallbackPolicy',
  'ExternalInterruptionPolicy',
  'ExternalRetentionPolicy',
  'ExternalThreadPolicy',
  'ExternalWorkerDispatchPolicy',
  'RunStatus',
  'WorkflowPhase',
  'externalBackendCapabilityRecordProjection',
  'isoTimestamp',
  'sha256Digest',
]);

const M251_EXECUTION_ADAPTER_IMPORTS = new Set([
  'CODEX_M251_WORKER_ACTIVITY_POLICY_DIGEST',
  'CODEX_M251_WORKER_ACTIVITY_POLICY_ID',
  'CODEX_M251_WORKER_ADAPTER_ID',
  'CODEX_M251_WORKER_ADAPTER_VERSION',
  'CODEX_M251_WORKER_DISABLED_INTEGRATIONS_DIGEST',
  'CODEX_M251_WORKER_ISOLATION_PROFILE_ID',
  'CodexWorkerPhaseIsolationInputV1',
  'codexM251WorkerIsolationProfileDigest',
]);

const M251_EXECUTION_DOMAIN_IMPORTS = new Set([
  'ExecutionProfile',
  'ExecutionProfileDefinition',
  'ExternalApprovalPolicy',
  'ExternalBackendCapability',
  'ExternalBackendCapabilityClassification',
  'ExternalBackendCapabilityRecord',
  'ExternalCommandNetworkPolicy',
  'ExternalCompactionPolicy',
  'ExternalContinuityPolicy',
  'ExternalExecutionPhaseDispatchEntry',
  'ExternalFallbackPolicy',
  'ExternalInstructionSourceBinding',
  'ExternalInterruptionPolicy',
  'ExternalPhaseCwdKind',
  'ExternalPhaseResponseSchemaPolicy',
  'ExternalPhaseSourceAuthorityKind',
  'ExternalProjectConfigurationPolicy',
  'ExternalRetentionPolicy',
  'ExternalThreadPolicy',
  'ExternalWorkerDispatchPolicy',
  'Sha256Digest',
  'WorkflowPhase',
  'auditEventId',
  'decodeExecutionProfileDefinition',
  'decodeExternalBackendCapabilityRecord',
  'decodeExternalExecutionProfileDefinition',
  'deriveCapabilityGrant',
  'executionProfileId',
  'executionProfileProjection',
  'externalBackendCapabilityRecordProjection',
  'sha256Digest',
]);

const M251_EXECUTION_RUNTIME_COMPOSITION_IMPORTS = new Set([
  'RuntimeExecutionProfile',
  'RuntimeExecutionProfileResolver',
  'bindRuntimeExecutionProfileAuthority',
]);

const M251_CODEX_ADAPTER_IMPORTS = new Set([
  'CODEX_M251_WORKER_DISABLED_FEATURES',
  'CodexAdapterDiagnosticEvent',
  'CodexAdapterObservationV2',
  'CodexWorkerPhaseDirectiveV1',
  'CodexWorkerRequestBindingV3',
  'CodexWorkerSharedProfileDirectiveV1',
  'CodexWorkerSourceAuthorityV1',
  'assertM251EffectiveConfiguration',
  'createCodexWorkerAdapter',
  'createCodexWorkerDirectiveV3',
  'decodeCodexCandidateWorkspaceLease',
  'digestCanonical',
]);

const M251_CODEX_CLIENT_IMPORTS = new Set([
  'AppServerProcessLaunch',
  'JsonValue',
  'VerifiedCodexInstallation',
  'createControlledAppServerLaunch',
  'isJsonObject',
  'startAppServerClient',
  'verifyBundledCodexInstallation',
]);

const M251_CODEX_DOMAIN_IMPORTS = new Set([
  'CandidateGenerationState',
  'ExternalBackendCapability',
  'ExternalBackendCapabilityClassification',
  'ExternalBackendCapabilityRecord',
  'ExternalExecutionIntent',
  'ExternalExecutionPhaseDispatchEntry',
  'ExternalExecutionProfileDefinitionV3',
  'ExternalFallbackPolicy',
  'ExternalPhaseSourceAuthorityKind',
  'ExternalRetentionPolicy',
  'ExternalThreadPolicy',
  'RunStatus',
  'Sha256Digest',
  'WorkflowPhase',
  'externalBackendCapabilityRecordProjection',
  'externalExecutionPhaseDispatchEntryProjection',
  'isoTimestamp',
  'sha256Digest',
]);

const M251_PRODUCTION_DOMAIN_IMPORTS = new Set([
  'CommandId',
  'Goal',
  'GoalId',
  'PolicyBundleId',
  'ProtectedAssetReadLeasePolicy',
  'Sha256Digest',
  'WorkflowId',
  'WorkflowPhase',
  'attemptId',
  'sha256Digest',
  'workerEventId',
]);

const M251_PRODUCTION_RUNTIME_COMPOSITION_IMPORTS = new Set([
  'CryptographicIdentityGenerator',
  'SystemUtcClock',
  'createM1DeterministicPhaseGuardEvaluator',
  'createProtectedM2WorkflowDriver',
  'createRecoveryCoordinator',
]);

const M251_PRODUCTION_VERIFICATION_IMPORTS = new Set([
  'DARWIN_SEATBELT_PROFILE_ID',
  'createDarwinSeatbeltIsolation',
  'createLocalCommandVerificationRunner',
  'createProtectedAssetReadLeaseAuthority',
  'darwinSeatbeltProtectedProfileDigest',
  'inspectProtectedVerificationAsset',
  'protectedVerificationAssetManifestDigest',
]);

const M251_PRODUCTION_WORKSPACE_IMPORTS = new Set([
  'createLocalCandidateWorkspace',
  'createLocalProjectReadWorkspace',
  'observeLocalCandidateSourceIdentity',
]);

const M2_PROOF_CLIENT_IMPORTS = new Set(['AppServerClientError', 'AppServerClientErrorCode']);

const M2_PROOF_DOMAIN_IMPORTS = new Set([
  'EvidenceKind',
  'EvidenceResultStatus',
  'ExecutionProfileDefinition',
  'ExternalExecutionRecord',
  'ExternalExecutionProfileDefinition',
  'ExternalWorkerDispatchPolicy',
  'PolicyBundleDefinition',
  'createGoal',
  'createWorkflow',
  'externalExecutionId',
  'executionProfileId',
  'goalId',
  'goalRevision',
  'isoTimestamp',
  'policyBundleId',
  'sha256Digest',
  'successCriterionId',
  'workflowId',
]);

const M2_PROOF_RUNTIME_COMPOSITION_IMPORTS = new Set([
  'CandidateLeasedWorkerFactory',
  'RuntimeExecutionProfile',
  'WorkflowDriverCapability',
  'createCandidateLeasedWorker',
  'createM1DeterministicPhaseGuardEvaluator',
  'createProtectedM2WorkflowDriver',
]);

const M2_PROOF_VERIFICATION_IMPORTS = new Set([
  'DARWIN_SEATBELT_PROFILE_ID',
  'LOCAL_COMMAND_RUNNER_IDENTITY',
  'LOCAL_COMMAND_RUNNER_VERSION',
  'createDarwinSeatbeltIsolation',
  'createLocalCommandVerificationRunner',
  'createProtectedAssetReadLeaseAuthority',
  'darwinSeatbeltProtectedProfileDigest',
  'inspectProtectedVerificationAsset',
  'protectedVerificationAssetManifestDigest',
]);

const PRIVILEGED_COMPOSITION_PACKAGE_IMPORTS = new Map([
  [
    'apps/cli/src/composition/intake-assistant-invocation.ts',
    new Map([
      ['@codeclosure/adapter-codex-intake', M25_INTAKE_ADAPTER_IMPORTS],
      ['@codeclosure/codex-app-server-client', M25_INTAKE_CLIENT_IMPORTS],
    ]),
  ],
  [
    'apps/cli/src/composition/trusted-intake-composition.ts',
    new Map([
      ['@codeclosure/domain', M25_INTAKE_DOMAIN_IMPORTS],
      ['@codeclosure/runtime/composition', M25_INTAKE_RUNTIME_COMPOSITION_IMPORTS],
    ]),
  ],
  [
    'apps/cli/src/composition/trusted-composition.ts',
    new Map([['@codeclosure/runtime/composition', TRUSTED_COMPOSITION_RUNTIME_IMPORTS]]),
  ],
  [
    'apps/cli/src/composition/sqlite-authority.ts',
    new Map([['@codeclosure/store-sqlite', TRUSTED_COMPOSITION_STORE_IMPORTS]]),
  ],
  [
    'apps/cli/src/composition/m1-runtime-profiles.ts',
    new Map([
      ['@codeclosure/runtime/composition', RUNTIME_PROFILE_COMPOSITION_IMPORTS],
      ['@codeclosure/testing', TRUSTED_COMPOSITION_TESTING_IMPORTS],
    ]),
  ],
  [
    'apps/cli/src/composition/m2-codex-worker-invocation.ts',
    new Map([
      ['@codeclosure/adapter-codex', M2_CODEX_ADAPTER_IMPORTS],
      ['@codeclosure/codex-app-server-client', M2_CODEX_CLIENT_IMPORTS],
      ['@codeclosure/domain', M2_CODEX_DOMAIN_IMPORTS],
      ['@codeclosure/runtime/composition', new Set(['CandidateLeasedWorkerAuthorityReader'])],
    ]),
  ],
  [
    'apps/cli/src/composition/m251-execution-authority.ts',
    new Map([
      ['@codeclosure/adapter-codex', M251_EXECUTION_ADAPTER_IMPORTS],
      ['@codeclosure/domain', M251_EXECUTION_DOMAIN_IMPORTS],
      ['@codeclosure/runtime/composition', M251_EXECUTION_RUNTIME_COMPOSITION_IMPORTS],
    ]),
  ],
  [
    'apps/cli/src/composition/m251-codex-worker-invocation.ts',
    new Map([
      ['@codeclosure/adapter-codex', M251_CODEX_ADAPTER_IMPORTS],
      ['@codeclosure/codex-app-server-client', M251_CODEX_CLIENT_IMPORTS],
      ['@codeclosure/domain', M251_CODEX_DOMAIN_IMPORTS],
      ['@codeclosure/runtime/composition', new Set(['CandidateLeasedWorkerAuthorityReader'])],
    ]),
  ],
  [
    'apps/cli/src/composition/m251-trusted-production-composition.ts',
    new Map([
      [
        '@codeclosure/adapter-codex',
        new Set(['CodexAdapterObservationV2', 'createCodexExternalProcessReconciler']),
      ],
      ['@codeclosure/domain', M251_PRODUCTION_DOMAIN_IMPORTS],
      ['@codeclosure/runtime/composition', M251_PRODUCTION_RUNTIME_COMPOSITION_IMPORTS],
      ['@codeclosure/verification-local', M251_PRODUCTION_VERIFICATION_IMPORTS],
      ['@codeclosure/workspace-local', M251_PRODUCTION_WORKSPACE_IMPORTS],
    ]),
  ],
  [
    'apps/cli/src/composition/m2-protected-demo-proof.ts',
    new Map([
      ['@codeclosure/codex-app-server-client', M2_PROOF_CLIENT_IMPORTS],
      ['@codeclosure/domain', M2_PROOF_DOMAIN_IMPORTS],
      ['@codeclosure/runtime/composition', M2_PROOF_RUNTIME_COMPOSITION_IMPORTS],
      ['@codeclosure/store-sqlite', new Set(['openSqliteControlStore'])],
      ['@codeclosure/testing', new Set(['DeterministicIds', 'FakeWorker', 'FakeWorkerFixture'])],
      ['@codeclosure/verification-local', M2_PROOF_VERIFICATION_IMPORTS],
      [
        '@codeclosure/workspace-local',
        new Set([
          'LocalCandidateSourceIdentity',
          'createLocalCandidateWorkspace',
          'observeLocalCandidateSourceIdentity',
        ]),
      ],
    ]),
  ],
  ['apps/cli/src/composition/m1-restart-proof-observer.ts', new Map()],
  ['apps/cli/src/composition/m1-proof-child-process.ts', new Map()],
  ['apps/cli/src/composition/m1-restart-resume-proof.ts', new Map()],
]);

const PRIVILEGED_COMPOSITION_EXPORTS = new Map([
  [
    'apps/cli/src/composition/intake-assistant-invocation.ts',
    Object.freeze({
      values: new Set(['createProductionIntakeAssistant']),
      types: new Set([
        'CreateProductionIntakeAssistantOptions',
        'PreparedIntakeExecutionRootDescriptor',
        'ProductionIntakeAssistantResource',
      ]),
    }),
  ],
  [
    'apps/cli/src/composition/trusted-intake-composition.ts',
    Object.freeze({
      values: new Set([
        'createIntakeCliComposition',
        'createIntakeCliInvocationComposition',
        'createIntakeCliInvocationCompositionWithAssistant',
      ]),
      types: new Set([
        'CreateIntakeCliCompositionOptions',
        'CreateIntakeCliInvocationCompositionOptions',
        'IntakeCliComposition',
      ]),
    }),
  ],
  [
    'apps/cli/src/composition/trusted-composition.ts',
    Object.freeze({
      values: new Set([
        'createCliCommandId',
        'createCliComposition',
        'createCliInvocationComposition',
        'createTrustedCliComposition',
        'validateCliStartProfileName',
      ]),
      types: new Set([
        'CliComposition',
        'CreateCliCompositionOptions',
        'CreateCliInvocationCompositionOptions',
        'TrustedCliComposition',
      ]),
    }),
  ],
  [
    'apps/cli/src/composition/sqlite-authority.ts',
    Object.freeze({
      values: new Set(['openCliSqliteAuthority']),
      types: new Set(['OpenCliSqliteAuthorityOptions']),
    }),
  ],
  [
    'apps/cli/src/composition/m1-runtime-profiles.ts',
    Object.freeze({
      values: new Set(['installM1RuntimeProfiles', 'parseM1RuntimeProfileName']),
      types: new Set(['M1RuntimeProfileRegistry', 'M1RuntimeProfileScenarioControl']),
    }),
  ],
  [
    'apps/cli/src/composition/m1-profile-demo-proof.ts',
    Object.freeze({
      values: new Set(['runM1DirectProfileProof']),
      types: new Set(),
    }),
  ],
  [
    'apps/cli/src/composition/m1-stale-closeout-proof.ts',
    Object.freeze({
      values: new Set(['runM1StaleCloseoutProof']),
      types: new Set(['M1StaleCloseoutProofResult', 'RunM1StaleCloseoutProofOptions']),
    }),
  ],
  [
    'apps/cli/src/composition/m1-proof-read-facade.ts',
    Object.freeze({
      values: new Set(['createM1ProofReadFacade']),
      types: new Set(['M1ProofReadFacade']),
    }),
  ],
  [
    'apps/cli/src/composition/m1-restart-proof-observer.ts',
    Object.freeze({
      values: new Set(['observeClaimedActiveAttempt']),
      types: new Set(['ClaimedActiveAttemptId', 'M1RestartProofObservationOptions']),
    }),
  ],
  [
    'apps/cli/src/composition/m1-proof-child-process.ts',
    Object.freeze({
      values: new Set([
        'completeM1ProofChildProcess',
        'spawnM1ProofChildProcess',
        'stopM1ProofChildProcess',
        'waitForM1ProofChildProcessClose',
      ]),
      types: new Set([
        'CompleteM1ProofChildProcessOptions',
        'CompletedM1ProofChildProcess',
        'M1ProofChildProcessExit',
        'RunningM1ProofChildProcess',
        'SpawnM1ProofChildProcessOptions',
      ]),
    }),
  ],
  [
    'apps/cli/src/composition/m1-restart-resume-proof.ts',
    Object.freeze({
      values: new Set(['runM1RestartResumeProof']),
      types: new Set(),
    }),
  ],
  [
    'apps/cli/src/composition/m2-codex-worker-invocation.ts',
    Object.freeze({
      values: new Set([
        'M2_CODEX_PERMISSION_PROFILE_ID',
        'createTrustedCodexInvocation',
        'prepareTrustedCodexProfile',
      ]),
      types: new Set([
        'CreateTrustedCodexInvocationInput',
        'M2CodexAdapterDiagnostic',
        'PrepareTrustedCodexProfileInput',
        'TrustedCodexProfileAuthority',
        'TrustedCodexRoots',
      ]),
    }),
  ],
  [
    'apps/cli/src/composition/m251-execution-authority.ts',
    Object.freeze({
      values: new Set([
        'M251_DRIVER_VERSION',
        'createM251FormalExecutionProfileDefinition',
        'createM251RuntimeProfileRegistry',
        'installM251ExecutionAuthority',
      ]),
      types: new Set([
        'InstallM251ExecutionAuthorityInput',
        'InstalledM251ExecutionAuthority',
        'M251FormalExecutionProfileInput',
        'M251PhaseExecutionAuthorityInput',
        'M251RuntimeProfileCapabilities',
        'M251RuntimeProfileRegistry',
      ]),
    }),
  ],
  [
    'apps/cli/src/composition/m251-codex-worker-invocation.ts',
    Object.freeze({
      values: new Set([
        'M251_CODEX_CONFIGURATION_PROFILE_ID',
        'M251_CODEX_INSTRUCTION_MANIFEST_ID',
        'M251_CODEX_PERMISSION_PROFILE_ID',
        'createM251TrustedCodexInvocation',
        'prepareM251TrustedCodexProfile',
      ]),
      types: new Set([
        'CreateM251TrustedCodexInvocationInput',
        'M251TrustedCodexProfileAuthority',
        'M251TrustedCodexRoots',
        'PrepareM251TrustedCodexProfileInput',
      ]),
    }),
  ],
  [
    'apps/cli/src/composition/m251-trusted-production-composition.ts',
    Object.freeze({
      values: new Set([
        'M251_PAYMENT_DEMO_EXPECTED_RESULT',
        'M251_PAYMENT_DEMO_PROJECT_CONTRACT',
        'M251_PAYMENT_DEMO_PROTECTED_CHECK_ID',
        'M251_PAYMENT_DEMO_PROTECTED_CHECK_VERSION',
        'createM251RealCodexProductionActivation',
        'createM251TrustedProductionComposition',
      ]),
      types: new Set([
        'CreateM251TrustedProductionCompositionOptions',
        'M251ExternalWorkerFactoryInput',
        'M251ProductionActivation',
        'M251ProductionProjectContract',
        'M251TrustedProductionComposition',
        'M251TrustedProductionIdentityGenerator',
        'M251TrustedProductionInspection',
        'M251TrustedProductionObservationSink',
        'M251TrustedProductionPhaseAuthority',
        'M251TrustedProductionRoots',
      ]),
    }),
  ],
  [
    'apps/cli/src/composition/m2-protected-demo-proof.ts',
    Object.freeze({
      values: new Set(['M2ExternalDemoBlockedError', 'runM2ProtectedDemoProof']),
      types: new Set([
        'M2AdapterFailureDemoProof',
        'M2ExternalDemoMode',
        'M2ExternalDemoOptions',
        'M2LiveDemoProof',
        'M2ProtectedDemoMode',
        'M2ProtectedDemoProof',
      ]),
    }),
  ],
]);

const TRUSTED_COMPOSITION_LOCAL_CONSUMERS = new Map([
  [
    'apps/cli/src/composition/index.ts',
    Object.freeze({
      kind: 'EXPORT_DECLARATION',
      values: new Set([
        'createCliCommandId',
        'createCliComposition',
        'createCliInvocationComposition',
        'validateCliStartProfileName',
      ]),
      types: new Set([
        'CliComposition',
        'CreateCliCompositionOptions',
        'CreateCliInvocationCompositionOptions',
      ]),
    }),
  ],
  [
    'apps/cli/src/composition/m1-profile-demo-proof.ts',
    Object.freeze({
      kind: 'IMPORT_DECLARATION',
      values: new Set([
        'createCliCommandId',
        'createCliComposition',
        'createTrustedCliComposition',
      ]),
      types: new Set(['CliComposition', 'CreateCliCompositionOptions', 'TrustedCliComposition']),
    }),
  ],
  [
    'apps/cli/src/composition/m1-stale-closeout-proof.ts',
    Object.freeze({
      kind: 'IMPORT_DECLARATION',
      values: new Set([
        'createCliCommandId',
        'createCliComposition',
        'createTrustedCliComposition',
      ]),
      types: new Set(['CreateCliCompositionOptions', 'TrustedCliComposition']),
    }),
  ],
  [
    'apps/cli/src/composition/m1-proof-read-facade.ts',
    Object.freeze({
      kind: 'IMPORT_DECLARATION',
      values: new Set(['createCliComposition']),
      types: new Set(['CreateCliCompositionOptions']),
    }),
  ],
  [
    'apps/cli/src/composition/m1-restart-resume-proof.ts',
    Object.freeze({
      kind: 'IMPORT_DECLARATION',
      values: new Set(),
      types: new Set(['CreateCliCompositionOptions']),
    }),
  ],
]);

const SENSITIVE_COMPOSITION_MODULE_IMPORTS = new Map([
  [
    'apps/cli/src/composition/trusted-intake-composition.js',
    new Map([
      [
        'apps/cli/src/composition/index.ts',
        Object.freeze({
          kind: 'EXPORT_DECLARATION',
          values: new Set(['createIntakeCliComposition', 'createIntakeCliInvocationComposition']),
          types: new Set([
            'CreateIntakeCliCompositionOptions',
            'CreateIntakeCliInvocationCompositionOptions',
            'IntakeCliComposition',
          ]),
        }),
      ],
    ]),
  ],
  [
    'apps/cli/src/composition/intake-assistant-invocation.js',
    new Map([
      [
        'apps/cli/src/composition/trusted-intake-composition.ts',
        new Set([
          'CreateProductionIntakeAssistantOptions',
          'ProductionIntakeAssistantResource',
          'createProductionIntakeAssistant',
        ]),
      ],
      [
        'apps/cli/src/composition/m251-trusted-production-composition.ts',
        Object.freeze({
          kind: 'IMPORT_DECLARATION',
          values: new Set(),
          types: new Set([
            'PreparedIntakeExecutionRootDescriptor',
            'ProductionIntakeAssistantResource',
          ]),
        }),
      ],
    ]),
  ],
  ['apps/cli/src/composition/trusted-composition.js', TRUSTED_COMPOSITION_LOCAL_CONSUMERS],
  [
    'apps/cli/src/composition/m1-proof-read-facade.js',
    new Map([
      [
        'apps/cli/src/composition/m1-restart-resume-proof.ts',
        Object.freeze({
          kind: 'IMPORT_DECLARATION',
          values: new Set(['createM1ProofReadFacade']),
          types: new Set(['M1ProofReadFacade']),
        }),
      ],
    ]),
  ],
  [
    'apps/cli/src/composition/sqlite-authority.js',
    new Map([
      [
        'apps/cli/src/composition/m1-restart-proof-observer.ts',
        new Set(['OpenCliSqliteAuthorityOptions', 'openCliSqliteAuthority']),
      ],
      [
        'apps/cli/src/composition/trusted-composition.ts',
        new Set(['OpenCliSqliteAuthorityOptions', 'openCliSqliteAuthority']),
      ],
      [
        'apps/cli/src/composition/trusted-intake-composition.ts',
        new Set(['OpenCliSqliteAuthorityOptions', 'openCliSqliteAuthority']),
      ],
      [
        'apps/cli/src/composition/m251-trusted-production-composition.ts',
        new Set(['OpenCliSqliteAuthorityOptions', 'openCliSqliteAuthority']),
      ],
    ]),
  ],
  [
    'apps/cli/src/composition/m1-runtime-profiles.js',
    new Map([
      [
        'apps/cli/src/composition/trusted-composition.ts',
        new Set([
          'M1RuntimeProfileScenarioControl',
          'installM1RuntimeProfiles',
          'parseM1RuntimeProfileName',
        ]),
      ],
      [
        'apps/cli/src/composition/trusted-intake-composition.ts',
        new Set(['installM1RuntimeProfiles', 'parseM1RuntimeProfileName']),
      ],
    ]),
  ],
  [
    'apps/cli/src/composition/m1-restart-proof-observer.js',
    new Map([
      [
        'apps/cli/src/composition/m1-restart-resume-proof.ts',
        new Set([
          'ClaimedActiveAttemptId',
          'M1RestartProofObservationOptions',
          'observeClaimedActiveAttempt',
        ]),
      ],
    ]),
  ],
  [
    'apps/cli/src/composition/m1-proof-child-process.js',
    new Map([
      [
        'apps/cli/src/composition/m1-restart-resume-proof.ts',
        new Set([
          'CompletedM1ProofChildProcess',
          'RunningM1ProofChildProcess',
          'completeM1ProofChildProcess',
          'spawnM1ProofChildProcess',
          'stopM1ProofChildProcess',
          'waitForM1ProofChildProcessClose',
        ]),
      ],
    ]),
  ],
  [
    'apps/cli/src/composition/m2-codex-worker-invocation.js',
    new Map([
      [
        'apps/cli/src/composition/m2-protected-demo-proof.ts',
        new Set([
          'M2CodexAdapterDiagnostic',
          'TrustedCodexProfileAuthority',
          'createTrustedCodexInvocation',
          'prepareTrustedCodexProfile',
        ]),
      ],
    ]),
  ],
  [
    'apps/cli/src/composition/m251-execution-authority.js',
    new Map([
      [
        'apps/cli/src/composition/m251-codex-worker-invocation.ts',
        new Set(['M251PhaseExecutionAuthorityInput']),
      ],
      [
        'apps/cli/src/composition/m251-trusted-production-composition.ts',
        new Set([
          'InstalledM251ExecutionAuthority',
          'M251PhaseExecutionAuthorityInput',
          'createM251RuntimeProfileRegistry',
          'installM251ExecutionAuthority',
        ]),
      ],
    ]),
  ],
  [
    'apps/cli/src/composition/m251-codex-worker-invocation.js',
    new Map([
      [
        'apps/cli/src/composition/m251-trusted-production-composition.ts',
        new Set(['M251TrustedCodexProfileAuthority', 'createM251TrustedCodexInvocation']),
      ],
    ]),
  ],
  ['apps/cli/src/composition/m251-trusted-production-composition.js', new Map()],
  [
    'apps/cli/src/composition/m2-protected-demo-proof.js',
    new Map([
      [
        'apps/cli/src/composition/demo-proof.ts',
        new Set(['M2ExternalDemoBlockedError', 'M2LiveDemoProof', 'runM2ProtectedDemoProof']),
      ],
    ]),
  ],
]);

const DYNAMIC_LOADER_MODULES = new Set(['module', 'node:module']);
const GENERAL_EXTERNAL_MODULES = new Set(['zod']);

const CLI_ENTRY_COMPOSITION_IMPORTS = new Set([
  'createCliCommandId',
  'createCliInvocationComposition',
  'createIntakeCliInvocationComposition',
  'runM1DemoProof',
  'runDemoProof',
  'validateCliStartProfileName',
]);

const TRUSTED_COMPOSITION_ROOT_EXPORTS = new Map([
  [
    './trusted-intake-composition.js',
    Object.freeze({
      values: new Set(['createIntakeCliComposition', 'createIntakeCliInvocationComposition']),
      types: new Set([
        'CreateIntakeCliCompositionOptions',
        'CreateIntakeCliInvocationCompositionOptions',
        'IntakeCliComposition',
      ]),
    }),
  ],
  [
    './m1-stale-closeout-proof.js',
    Object.freeze({
      values: new Set(['runM1StaleCloseoutProof']),
      types: new Set(['M1StaleCloseoutProofResult', 'RunM1StaleCloseoutProofOptions']),
    }),
  ],
  ['./m1-demo-proof.js', Object.freeze({ values: new Set(['runM1DemoProof']), types: new Set() })],
  ['./demo-proof.js', Object.freeze({ values: new Set(['runDemoProof']), types: new Set() })],
  [
    './trusted-composition.js',
    Object.freeze({
      values: new Set([
        'createCliCommandId',
        'createCliComposition',
        'createCliInvocationComposition',
        'validateCliStartProfileName',
      ]),
      types: new Set([
        'CliComposition',
        'CreateCliCompositionOptions',
        'CreateCliInvocationCompositionOptions',
      ]),
    }),
  ],
]);

const CliSourceZone = Object.freeze({
  ENTRY_POINT: 'ENTRY_POINT',
  HANDLER: 'HANDLER',
  COMPOSITION_SUPPORT: 'COMPOSITION_SUPPORT',
  TRUSTED_COMPOSITION: 'TRUSTED_COMPOSITION',
});

const NODE_BUILTIN_MODULES_BY_ZONE = new Map([
  [CliSourceZone.ENTRY_POINT, new Set()],
  [CliSourceZone.HANDLER, new Set(['node:path', 'node:util'])],
  [CliSourceZone.COMPOSITION_SUPPORT, new Set(['node:path', 'node:util'])],
  [CliSourceZone.TRUSTED_COMPOSITION, new Set()],
]);

const NODE_BUILTIN_MODULES_BY_FILE = new Map([
  [
    'apps/cli/src/composition/intake-assistant-invocation.ts',
    new Set(['node:crypto', 'node:fs', 'node:os', 'node:path']),
  ],
  ['apps/cli/src/composition/data-home.ts', new Set(['node:fs'])],
  ['apps/cli/src/composition/m1-demo-proof.ts', new Set(['node:fs', 'node:os'])],
  ['apps/cli/src/composition/m1-profile-demo-proof.ts', new Set(['node:fs', 'node:os'])],
  ['apps/cli/src/composition/m1-proof-child-process.ts', new Set(['node:child_process'])],
  [
    'apps/cli/src/composition/m1-restart-resume-proof.ts',
    new Set(['node:fs', 'node:os', 'node:path', 'node:timers/promises', 'node:url']),
  ],
  ['apps/cli/src/composition/m1-stale-closeout-proof.ts', new Set(['node:fs', 'node:os'])],
  ['apps/cli/src/composition/recovery-inspector.ts', new Set(['node:fs'])],
  ['apps/cli/src/composition/demo-proof.ts', new Set(['node:fs', 'node:os', 'node:path'])],
  ['apps/cli/src/composition/m2-codex-worker-invocation.ts', new Set(['node:fs', 'node:path'])],
  ['apps/cli/src/composition/m251-codex-worker-invocation.ts', new Set(['node:fs', 'node:path'])],
  [
    'apps/cli/src/composition/m251-trusted-production-composition.ts',
    new Set(['node:child_process', 'node:crypto', 'node:fs', 'node:path']),
  ],
  [
    'apps/cli/src/composition/m2-protected-demo-proof.ts',
    new Set(['node:child_process', 'node:crypto', 'node:fs', 'node:os', 'node:path']),
  ],
]);

// This source gate catches statically evident engineering miswiring. It is not a
// sandbox for hostile JavaScript; Runtime and Store boundaries remain authoritative.
const REFLECTIVE_BUILTIN_LOADER_READERS = Object.freeze([
  Object.freeze({ owner: 'Reflect', method: 'get' }),
  Object.freeze({ owner: 'Reflect', method: 'getOwnPropertyDescriptor' }),
  Object.freeze({ owner: 'Object', method: 'getOwnPropertyDescriptor' }),
]);

function repositoryRelativePath(filePath, repositoryRoot) {
  return relative(resolve(repositoryRoot), resolve(filePath)).split(sep).join('/');
}

function isWithin(candidate, root) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep));
}

function sourceZone(filePath, repositoryRoot) {
  const absoluteFilePath = resolve(filePath);
  if (isWithin(absoluteFilePath, resolve(repositoryRoot, 'apps/cli/src/composition'))) {
    return PRIVILEGED_COMPOSITION_PACKAGE_IMPORTS.has(
      repositoryRelativePath(filePath, repositoryRoot),
    )
      ? CliSourceZone.TRUSTED_COMPOSITION
      : CliSourceZone.COMPOSITION_SUPPORT;
  }
  if (absoluteFilePath === resolve(repositoryRoot, 'apps/cli/src/index.ts')) {
    return CliSourceZone.ENTRY_POINT;
  }
  return CliSourceZone.HANDLER;
}

function isTrustedCompositionRoot(filePath, repositoryRoot) {
  return resolve(filePath) === resolve(repositoryRoot, 'apps/cli/src/composition/index.ts');
}

function privilegedPackageMatch(specifier) {
  for (const [root, reason] of PRIVILEGED_PACKAGE_ROOTS) {
    if (specifier === root || specifier.startsWith(`${root}/`)) {
      return Object.freeze({ exact: specifier === root, reason, root });
    }
  }
  return undefined;
}

function relativeModuleTarget(specifier, filePath) {
  return specifier.startsWith('.') ? resolve(dirname(filePath), specifier) : undefined;
}

function normalizeModuleSpecifierForInspection(specifier) {
  const normalized = specifier.replaceAll('\\', '/');
  return Object.freeze({
    ambiguousSeparators: normalized !== specifier,
    normalized,
  });
}

function isApprovedNodeBuiltin(specifier, zone, relativeFilePath) {
  return (
    NODE_BUILTIN_MODULES_BY_ZONE.get(zone)?.has(specifier) === true ||
    NODE_BUILTIN_MODULES_BY_FILE.get(relativeFilePath)?.has(specifier) === true
  );
}

function importedName(specifier) {
  return specifier.propertyName?.text ?? specifier.name.text;
}

function position(sourceFile, node) {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return Object.freeze({ line: location.line + 1, column: location.character + 1 });
}

function violation(sourceFile, node, specifier, reason) {
  return Object.freeze({
    filePath: sourceFile.fileName,
    specifier,
    reason,
    ...position(sourceFile, node),
  });
}

function createBoundSourceFile(source, filePath) {
  const absoluteFilePath = resolve(filePath);
  const options = {
    module: ts.ModuleKind.ESNext,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
    types: [],
  };
  const parsedSourceFile = ts.createSourceFile(
    absoluteFilePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const host = ts.createCompilerHost(options);
  host.fileExists = (candidate) => resolve(candidate) === absoluteFilePath;
  host.readFile = (candidate) => (resolve(candidate) === absoluteFilePath ? source : undefined);
  host.getSourceFile = (candidate) =>
    resolve(candidate) === absoluteFilePath ? parsedSourceFile : undefined;
  const program = ts.createProgram([absoluteFilePath], options, host);
  return Object.freeze({
    checker: program.getTypeChecker(),
    sourceFile: program.getSourceFile(absoluteFilePath) ?? parsedSourceFile,
  });
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function staticPropertyName(node) {
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.text;
  }
  return ts.isComputedPropertyName(node) ? staticPropertyName(node.expression) : undefined;
}

function isAmbientGlobalIdentifier(node, name, checker) {
  const expression = unwrapExpression(node);
  return (
    ts.isIdentifier(expression) &&
    expression.text === name &&
    checker.getSymbolAtLocation(expression) === undefined
  );
}

function isNamedAmbientGlobalMemberAccess(node, owner, member, checker) {
  const expression = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(expression)) {
    return (
      expression.name.text === member &&
      isAmbientGlobalIdentifier(expression.expression, owner, checker)
    );
  }
  return (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression !== undefined &&
    staticPropertyName(expression.argumentExpression) === member &&
    isAmbientGlobalIdentifier(expression.expression, owner, checker)
  );
}

function isProcessBuiltinModuleAccess(node, checker) {
  return isNamedAmbientGlobalMemberAccess(node, 'process', 'getBuiltinModule', checker);
}

function isReflectiveProcessBuiltinModuleRead(node, checker) {
  if (!ts.isCallExpression(node) || node.arguments.length < 2) {
    return false;
  }
  const [target, property] = node.arguments;
  if (
    target === undefined ||
    property === undefined ||
    !isAmbientGlobalIdentifier(target, 'process', checker) ||
    staticPropertyName(property) !== 'getBuiltinModule'
  ) {
    return false;
  }
  return REFLECTIVE_BUILTIN_LOADER_READERS.some(({ owner, method }) =>
    isNamedAmbientGlobalMemberAccess(node.expression, owner, method, checker),
  );
}

function processBuiltinModuleBindingElements(node, checker) {
  if (
    (!ts.isVariableDeclaration(node) && !ts.isParameter(node)) ||
    !ts.isObjectBindingPattern(node.name) ||
    node.initializer === undefined ||
    !isAmbientGlobalIdentifier(node.initializer, 'process', checker)
  ) {
    return [];
  }
  return node.name.elements.filter((element) => {
    const name = element.propertyName ?? element.name;
    return staticPropertyName(name) === 'getBuiltinModule';
  });
}

function processBuiltinModuleAssignmentProperties(node, checker) {
  if (
    !ts.isBinaryExpression(node) ||
    node.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
    !isAmbientGlobalIdentifier(node.right, 'process', checker)
  ) {
    return [];
  }
  const target = unwrapExpression(node.left);
  if (!ts.isObjectLiteralExpression(target)) {
    return [];
  }
  return target.properties.filter((property) => {
    if (ts.isSpreadAssignment(property)) {
      return false;
    }
    return staticPropertyName(property.name) === 'getBuiltinModule';
  });
}

function isRuntimeIdentifierReference(node) {
  const parent = node.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isQualifiedName(parent) && parent.right === node) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportEqualsDeclaration(parent) ||
    (ts.isLabeledStatement(parent) && parent.label === node) ||
    (ts.isBreakOrContinueStatement(parent) && parent.label === node) ||
    ts.isTypeNode(parent)
  ) {
    return false;
  }
  return true;
}

function hasModifier(node, kind) {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true
  );
}

export function findCliBoundaryViolationsInSource(source, filePath, repositoryRoot) {
  const { checker, sourceFile } = createBoundSourceFile(source, filePath);
  const violations = [];
  const zone = sourceZone(filePath, repositoryRoot);
  const relativeFilePath = repositoryRelativePath(filePath, repositoryRoot);
  const privilegedPackageImports = PRIVILEGED_COMPOSITION_PACKAGE_IMPORTS.get(relativeFilePath);
  const privilegedExports = PRIVILEGED_COMPOSITION_EXPORTS.get(relativeFilePath);
  const compositionRoot = isTrustedCompositionRoot(filePath, repositoryRoot);
  const trustedImportedBindings = new Set();

  if (zone === CliSourceZone.TRUSTED_COMPOSITION) {
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const specifier = statement.moduleSpecifier.text;
      if (specifier !== '@codeclosure/runtime' && privilegedPackageMatch(specifier) === undefined) {
        continue;
      }
      const bindings = statement.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          trustedImportedBindings.add(element.name.text);
        }
      }
    }
  }

  function record(reasonNode, specifier, reason) {
    violations.push(violation(sourceFile, reasonNode, specifier, reason));
  }

  function checkPrivilegedExportName(node, name, kind) {
    if (!privilegedExports[kind].has(name)) {
      record(
        node,
        name,
        `This privileged CLI composition module may not export unapproved ${kind === 'types' ? 'type' : 'value'} ${name}.`,
      );
    }
  }

  if (privilegedExports !== undefined) {
    for (const statement of sourceFile.statements) {
      if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
        record(
          statement,
          relativeFilePath,
          'Privileged CLI composition modules must export only direct named declarations, never forwarding exports.',
        );
        continue;
      }
      if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
        continue;
      }
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
        record(
          statement,
          relativeFilePath,
          'Privileged CLI composition modules must not use default exports.',
        );
        continue;
      }
      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
        checkPrivilegedExportName(statement.name, statement.name.text, 'types');
        continue;
      }
      if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
        checkPrivilegedExportName(statement.name, statement.name.text, 'values');
        continue;
      }
      if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
        checkPrivilegedExportName(statement.name, statement.name.text, 'values');
        continue;
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            checkPrivilegedExportName(declaration.name, declaration.name.text, 'values');
          } else {
            record(
              declaration.name,
              relativeFilePath,
              'Privileged CLI composition exports must have one explicit identifier.',
            );
          }
        }
        continue;
      }
      record(
        statement,
        relativeFilePath,
        'Privileged CLI composition uses an unsupported exported declaration form.',
      );
    }
  }

  if (compositionRoot) {
    for (const statement of sourceFile.statements) {
      if (
        !ts.isExportDeclaration(statement) ||
        statement.moduleSpecifier === undefined ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.exportClause === undefined ||
        !ts.isNamedExports(statement.exportClause)
      ) {
        record(
          statement,
          'composition/index.ts',
          'The trusted composition root must be a closed manifest of explicit named re-exports.',
        );
        continue;
      }
      const moduleSpecifier = statement.moduleSpecifier.text;
      const allowed = TRUSTED_COMPOSITION_ROOT_EXPORTS.get(moduleSpecifier);
      if (allowed === undefined) {
        record(
          statement.moduleSpecifier,
          moduleSpecifier,
          'The trusted composition root may re-export only from its approved facade modules.',
        );
        continue;
      }
      for (const element of statement.exportClause.elements) {
        const exportedName = element.name.text;
        const sourceName = element.propertyName?.text ?? exportedName;
        const typeOnly = statement.isTypeOnly || element.isTypeOnly;
        const approvedNames = typeOnly ? allowed.types : allowed.values;
        if (sourceName !== exportedName || !approvedNames.has(exportedName)) {
          record(
            element,
            moduleSpecifier,
            `The trusted composition root may not ${typeOnly ? 'type-' : ''}export ${sourceName} as ${exportedName}.`,
          );
        }
      }
    }
  }

  function requireExplicitNamedImport(node, specifier, kind, audience) {
    if (kind !== 'IMPORT_DECLARATION') {
      record(
        node,
        specifier,
        `${audience} may use this module only through an explicit static named import.`,
      );
      return false;
    }
    const clause = node.importClause;
    if (
      clause === undefined ||
      clause.name !== undefined ||
      clause.namedBindings === undefined ||
      ts.isNamespaceImport(clause.namedBindings)
    ) {
      record(
        node,
        specifier,
        `${audience} may not use side-effect, default, or namespace imports for this module.`,
      );
      return false;
    }
    return true;
  }

  function requireApprovedNamedSensitiveUse(node, specifier, kind, rule) {
    if (kind !== rule.kind) {
      record(
        node,
        specifier,
        rule.kind === 'EXPORT_DECLARATION'
          ? 'This sensitive local authority may be re-exported only by its named composition root.'
          : 'This sensitive local authority may be imported only by its named composition consumer.',
      );
      return;
    }

    let elements;
    let declarationTypeOnly;
    if (kind === 'IMPORT_DECLARATION') {
      if (
        !requireExplicitNamedImport(node, specifier, kind, 'Sensitive CLI composition consumers')
      ) {
        return;
      }
      elements = node.importClause.namedBindings.elements;
      declarationTypeOnly = node.importClause.isTypeOnly;
    } else if (
      ts.isExportDeclaration(node) &&
      node.exportClause !== undefined &&
      ts.isNamedExports(node.exportClause)
    ) {
      elements = node.exportClause.elements;
      declarationTypeOnly = node.isTypeOnly;
    } else {
      record(
        node,
        specifier,
        'The trusted composition root must use an explicit static named re-export.',
      );
      return;
    }

    for (const element of elements) {
      const sourceName = element.propertyName?.text ?? element.name.text;
      const typeOnly = declarationTypeOnly || element.isTypeOnly;
      const approvedNames = typeOnly ? rule.types : rule.values;
      if (sourceName !== element.name.text || !approvedNames.has(sourceName)) {
        record(
          element,
          specifier,
          `This named composition consumer may not ${typeOnly ? 'type-' : ''}${kind === 'EXPORT_DECLARATION' ? 'export' : 'import'} unapproved or aliased capability ${sourceName}.`,
        );
      }
    }
  }

  function recordModuleUse(node, specifier, kind) {
    const inspectedSpecifier = normalizeModuleSpecifierForInspection(specifier);
    if (inspectedSpecifier.ambiguousSeparators) {
      record(
        node,
        specifier,
        'CLI module specifiers must use forward slashes; NodeNext treats backslashes as path separators, so this spelling is ambiguous to a POSIX path gate.',
      );
      return;
    }

    if (DYNAMIC_LOADER_MODULES.has(specifier)) {
      record(
        node,
        specifier,
        'CLI source must not acquire a dynamic module loader; all authority imports must remain statically inspectable.',
      );
      return;
    }

    const relativeTarget = relativeModuleTarget(specifier, filePath);
    if (
      relativeTarget !== undefined &&
      !isWithin(relativeTarget, resolve(repositoryRoot, 'apps/cli/src'))
    ) {
      record(
        node,
        specifier,
        'CLI relative imports must remain inside apps/cli/src; external dependencies must use approved package exports.',
      );
      return;
    }

    if (
      specifier.startsWith('@codeclosure/runtime/') &&
      privilegedPackageMatch(specifier) === undefined
    ) {
      record(
        node,
        specifier,
        zone === CliSourceZone.TRUSTED_COMPOSITION
          ? 'Trusted CLI composition may use only the named Runtime composition export, never testing or other Runtime subpaths.'
          : 'CLI adapters must not import Runtime composition, testing, or other package subpaths.',
      );
      return;
    }

    const privileged = privilegedPackageMatch(specifier);
    if (privileged !== undefined) {
      const allowedNames = privilegedPackageImports?.get(privileged.root);
      if (zone !== CliSourceZone.TRUSTED_COMPOSITION || allowedNames === undefined) {
        record(node, specifier, privileged.reason);
      } else if (!privileged.exact) {
        record(
          node,
          specifier,
          'Trusted CLI composition must use the declared package root, not an undeclared package subpath.',
        );
      } else {
        const explicit = requireExplicitNamedImport(
          node,
          specifier,
          kind,
          'Trusted CLI composition',
        );
        if (explicit) {
          for (const element of node.importClause.namedBindings.elements) {
            const name = importedName(element);
            if (!allowedNames.has(name)) {
              record(
                element,
                specifier,
                `This trusted CLI composition module may not import unapproved capability ${name}.`,
              );
            }
          }
        }
      }
      return;
    }

    if (
      relativeTarget !== undefined &&
      isWithin(relativeTarget, resolve(repositoryRoot, 'apps/cli/src/composition')) &&
      zone !== CliSourceZone.TRUSTED_COMPOSITION &&
      zone !== CliSourceZone.COMPOSITION_SUPPORT
    ) {
      if (zone !== CliSourceZone.ENTRY_POINT) {
        record(
          node,
          specifier,
          'CLI handlers must receive facade capabilities; only the CLI entry point may invoke trusted composition.',
        );
      } else {
        const compositionRoot = resolve(repositoryRoot, 'apps/cli/src/composition/index.js');
        if (relativeTarget !== compositionRoot) {
          record(
            node,
            specifier,
            'The CLI entry point may import only the trusted composition root.',
          );
        } else {
          if (requireExplicitNamedImport(node, specifier, kind, 'The CLI entry point')) {
            for (const element of node.importClause.namedBindings.elements) {
              const name = importedName(element);
              if (!CLI_ENTRY_COMPOSITION_IMPORTS.has(name)) {
                record(
                  element,
                  specifier,
                  `The CLI entry point may not import unapproved composition capability ${name}.`,
                );
              }
            }
          }
        }
      }
      return;
    }

    if (
      relativeTarget !== undefined &&
      isWithin(relativeTarget, resolve(repositoryRoot, 'apps/cli/src/composition'))
    ) {
      const targetPath = repositoryRelativePath(relativeTarget, repositoryRoot);
      const importerRules = SENSITIVE_COMPOSITION_MODULE_IMPORTS.get(targetPath);
      if (importerRules !== undefined) {
        const consumerRule = importerRules.get(relativeFilePath);
        if (consumerRule === undefined) {
          record(
            node,
            specifier,
            'This internal composition authority may be imported only by its named trusted owner.',
          );
        } else if (!(consumerRule instanceof Set)) {
          requireApprovedNamedSensitiveUse(node, specifier, kind, consumerRule);
        } else if (
          requireExplicitNamedImport(node, specifier, kind, 'Sensitive CLI composition consumers')
        ) {
          for (const element of node.importClause.namedBindings.elements) {
            const name = importedName(element);
            if (!consumerRule.has(name)) {
              record(
                element,
                specifier,
                `This CLI composition module may not import unapproved internal capability ${name}.`,
              );
            }
          }
        }
      }
      return;
    }

    if (relativeTarget !== undefined) {
      return;
    }

    if (specifier === '@codeclosure/runtime') {
      if (
        !requireExplicitNamedImport(
          node,
          specifier,
          kind,
          zone === CliSourceZone.TRUSTED_COMPOSITION ? 'Trusted CLI composition' : 'CLI adapters',
        )
      ) {
        return;
      }

      if (
        zone === CliSourceZone.TRUSTED_COMPOSITION ||
        zone === CliSourceZone.COMPOSITION_SUPPORT
      ) {
        return;
      }
      for (const element of node.importClause.namedBindings.elements) {
        const name = importedName(element);
        if (!PUBLIC_ADAPTER_RUNTIME_IMPORTS.has(name)) {
          record(
            element,
            specifier,
            `CLI adapters may not import non-facade Runtime capability ${name}.`,
          );
        }
      }
      return;
    }

    if (specifier.startsWith('node:')) {
      if (!isApprovedNodeBuiltin(specifier, zone, relativeFilePath)) {
        record(
          node,
          specifier,
          'This CLI source zone or concrete composition owner is not approved to import this Node built-in module.',
        );
      }
      return;
    }

    if (GENERAL_EXTERNAL_MODULES.has(specifier)) {
      return;
    }

    record(
      node,
      specifier,
      'CLI source may import only approved Node built-ins, declared public dependencies, or local source modules.',
    );
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      recordModuleUse(node, node.moduleSpecifier.text, 'IMPORT_DECLARATION');
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
        recordModuleUse(node, node.moduleSpecifier.text, 'EXPORT_DECLARATION');
      } else if (
        zone === CliSourceZone.TRUSTED_COMPOSITION &&
        node.exportClause !== undefined &&
        ts.isNamedExports(node.exportClause)
      ) {
        for (const element of node.exportClause.elements) {
          const localName = element.propertyName?.text ?? element.name.text;
          if (trustedImportedBindings.has(localName)) {
            record(
              element,
              localName,
              'Trusted CLI composition must not re-export an imported control capability.',
            );
          }
        }
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      recordModuleUse(node, node.moduleReference.expression.text, 'IMPORT_EQUALS');
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        recordModuleUse(node, argument.literal.text, 'IMPORT_TYPE');
      }
    } else if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      for (const element of processBuiltinModuleBindingElements(node, checker)) {
        record(
          element,
          'process.getBuiltinModule',
          'CLI source must not retain or alias the process builtin-module loader.',
        );
      }
    } else if (ts.isBinaryExpression(node)) {
      for (const property of processBuiltinModuleAssignmentProperties(node, checker)) {
        record(
          property,
          'process.getBuiltinModule',
          'CLI source must not retain or alias the process builtin-module loader.',
        );
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        record(
          node,
          argument !== undefined && ts.isStringLiteral(argument)
            ? argument.text
            : '<dynamic import>',
          'CLI source must use explicit static imports; dynamic import is prohibited.',
        );
      } else if (isAmbientGlobalIdentifier(node.expression, 'require', checker)) {
        const argument = node.arguments[0];
        record(
          node,
          argument !== undefined && ts.isStringLiteral(argument) ? argument.text : '<require>',
          'CLI source must use explicit static imports; require is prohibited.',
        );
      } else if (isReflectiveProcessBuiltinModuleRead(node, checker)) {
        record(
          node,
          'process.getBuiltinModule',
          'CLI source must not acquire the process builtin-module loader through reflective property access.',
        );
      }
    } else if (
      ts.isIdentifier(node) &&
      node.text === 'require' &&
      checker.getSymbolAtLocation(node) === undefined &&
      isRuntimeIdentifierReference(node) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      record(node, 'require', 'CLI source must not retain or alias a dynamic module loader.');
    } else if (isProcessBuiltinModuleAccess(node, checker)) {
      record(
        node,
        'process.getBuiltinModule',
        'CLI source must not retain or alias a dynamic module loader.',
      );
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return Object.freeze(violations);
}

function listTypeScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new TypeError(`CLI source must not be a symbolic link: ${path}`);
    }
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      if (!lstatSync(path).isFile()) {
        throw new TypeError(`CLI TypeScript source is not a regular file: ${path}`);
      }
      files.push(path);
    }
  }
  return files.sort();
}

export function checkCliBoundary(repositoryRoot) {
  const sourceRoot = resolve(repositoryRoot, 'apps/cli/src');
  return Object.freeze(
    listTypeScriptFiles(sourceRoot).flatMap((filePath) =>
      findCliBoundaryViolationsInSource(readFileSync(filePath, 'utf8'), filePath, repositoryRoot),
    ),
  );
}
