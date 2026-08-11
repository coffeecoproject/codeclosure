import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';

import {
  ExternalApprovalPolicy,
  ExternalBackendCapability,
  ExternalBackendCapabilityClassification,
  ExternalCommandNetworkPolicy,
  ExternalCompactionPolicy,
  ExternalContinuityPolicy,
  ExternalFallbackPolicy,
  ExternalInterruptionPolicy,
  ExternalPhaseCwdKind,
  ExternalPhaseResponseSchemaPolicy,
  ExternalPhaseSourceAuthorityKind,
  ExternalProjectConfigurationPolicy,
  ExternalRetentionPolicy,
  ExternalThreadPolicy,
  ExternalWorkerDispatchPolicy,
  WorkflowPhase,
  decodeExternalExecutionProfileDefinition,
  deriveCapabilityGrant,
  executionProfileId,
  externalBackendCapabilityRecordProjection,
  isoTimestamp,
  type ExecutionProfileDefinition,
  type ExternalBackendCapabilityRecord,
  type ExternalExecutionPhaseDispatchEntry,
  type ExternalExecutionProfileDefinitionV3,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  createExecutionProfileInstaller,
  m1WorkerResponseContract,
} from '@codeclosure/runtime';
import { openSqliteControlStore } from '@codeclosure/store-sqlite';
import { DeterministicIds, testExecutionProfileDefinition } from '@codeclosure/testing';

const digests = new CanonicalJsonSha256DigestProvider();
const installedAt = isoTimestamp('2026-08-09T12:00:00.000Z');
const workerPhases = Object.freeze([
  WorkflowPhase.DISCOVERY,
  WorkflowPhase.IMPLEMENT,
  WorkflowPhase.PLAN,
]);

function temporaryDatabase(t: TestContext, namespace: string): string {
  const root = mkdtempSync(join(tmpdir(), `codeclosure-external-v3-${namespace}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return join(root, 'authority.sqlite');
}

function authority(namespace: string): Readonly<{
  capability: ExternalBackendCapabilityRecord;
  profile: ExecutionProfileDefinition;
}> {
  const binaryIdentityDigest = digests.digest({ namespace, kind: 'binary' });
  const protocolSchemaDigest = digests.digest({ namespace, kind: 'protocol' });
  const configurationProfileDigest = digests.digest({ namespace, kind: 'configuration' });
  const selectedCapabilities = Object.freeze(
    [
      ExternalBackendCapability.CONTROLLED_STATE_REOPEN,
      ExternalBackendCapability.FRESH_SESSION,
      ExternalBackendCapability.OPERATION_INTERRUPT,
      ExternalBackendCapability.SAME_SESSION_BOUNDED_OPERATION,
    ].toSorted(),
  );
  const capabilityWithoutDigest: Omit<ExternalBackendCapabilityRecord, 'recordDigest'> =
    Object.freeze({
      schemaVersion: 1,
      backendKind: 'CODEX_APP_SERVER',
      binaryIdentityDigest,
      protocolSchemaDigest,
      configurationProfileDigest,
      capabilityEntries: Object.freeze(
        selectedCapabilities.map((capability) =>
          Object.freeze({
            capability,
            classification: ExternalBackendCapabilityClassification.SUPPORTED,
            proofKind: 'DETERMINISTIC_M251_PROFILE_V3_FIXTURE',
          }),
        ),
      ),
      observedAt: installedAt,
    });
  const capability: ExternalBackendCapabilityRecord = Object.freeze({
    ...capabilityWithoutDigest,
    recordDigest: digests.digest(
      externalBackendCapabilityRecordProjection(capabilityWithoutDigest),
    ),
  });
  const activityPolicyDigest = digests.digest({
    id: 'codex-worker-activity-policy_codeclosure-m2-5-1-real',
    version: 'codeclosure-m2-5-1-worker-activity-v1',
  });
  const controlledStateRootIdentity = `/authority/${namespace}/codex-state`;
  const phaseDispatch = Object.freeze(
    workerPhases.map((phase): ExternalExecutionPhaseDispatchEntry => {
      const candidateFree = phase !== WorkflowPhase.IMPLEMENT;
      const instructionSources = Object.freeze([]);
      return Object.freeze({
        phase,
        workerAdapter: 'codex-app-server-worker',
        workerAdapterVersion: 'codeclosure-m2-5-1-worker-v1',
        cwdKind: candidateFree
          ? ExternalPhaseCwdKind.PROJECT_READ_SNAPSHOT
          : ExternalPhaseCwdKind.CANDIDATE_WORKSPACE,
        sourceAuthorityKind: candidateFree
          ? ExternalPhaseSourceAuthorityKind.PROJECT_READ
          : ExternalPhaseSourceAuthorityKind.CANDIDATE,
        permissionProfileId: `permission-${phase.toLowerCase()}-v1`,
        permissionProfileDigest: digests.digest({ namespace, phase, kind: 'permission' }),
        isolationProfileId: `isolation-${phase.toLowerCase()}-v1`,
        isolationProfileDigest: digests.digest({ namespace, phase, kind: 'isolation' }),
        projectConfigurationPolicy: ExternalProjectConfigurationPolicy.DISABLED,
        configurationProfileDigest,
        executionConfigDigest: digests.digest({ namespace, phase, kind: 'execution-config' }),
        disabledIntegrationsDigest: digests.digest({
          namespace,
          phase,
          kind: 'disabled-integrations',
        }),
        instructionSourceManifestId: `instructions-${phase.toLowerCase()}-v1`,
        instructionSourceManifestDigest: digests.digest({ instructionSources }),
        instructionSources,
        capabilityGrantDigest: digests.digest({
          schemaVersion: 1,
          capabilityGrant: deriveCapabilityGrant(phase),
        }),
        responseContractDigest: digests.digest({
          schemaVersion: 1,
          responseContract: m1WorkerResponseContract(phase),
        }),
        responseSchemaPolicy: candidateFree
          ? ExternalPhaseResponseSchemaPolicy.PROPOSALS_V1
          : ExternalPhaseResponseSchemaPolicy.COMPLETION_REQUEST_V1,
        workerActivityPolicyId: 'codex-worker-activity-policy_codeclosure-m2-5-1-real',
        workerActivityPolicyDigest: activityPolicyDigest,
        commandNetworkPolicy: ExternalCommandNetworkPolicy.DENIED,
        approvalPolicy: ExternalApprovalPolicy.NEVER,
        continuityPolicy: ExternalContinuityPolicy.SAME_SESSION_BOUNDED_OPERATION,
        compactionPolicy: ExternalCompactionPolicy.FAIL_ON_OBSERVATION,
        fallbackPolicy: ExternalFallbackPolicy.FAIL_CLOSED,
        allowedRoots: Object.freeze([`/authority/workspaces/${phase.toLowerCase()}`]),
        forbiddenRoots: Object.freeze(
          ['/authority/control', controlledStateRootIdentity, '/source/project'].toSorted(),
        ),
      });
    }),
  );
  const externalExecution: ExternalExecutionProfileDefinitionV3 = Object.freeze({
    schemaVersion: 3,
    backendKind: capability.backendKind,
    capabilityRecordDigest: capability.recordDigest,
    selectedCapabilities,
    workerPhases,
    binaryIdentityDigest,
    protocolSchemaDigest,
    managedRequirementsDigest: digests.digest({ namespace, kind: 'managed-requirements' }),
    controlledStateRootIdentity,
    environmentProjectionDigest: digests.digest({ namespace, kind: 'environment' }),
    model: 'gpt-fixture',
    modelProvider: 'openai',
    serviceTier: null,
    reasoningEffort: 'low',
    defaultThreadPolicy: ExternalThreadPolicy.FRESH,
    retentionPolicy: ExternalRetentionPolicy.CONTROLLED,
    interruptionPolicy: ExternalInterruptionPolicy.INTERRUPT_OPERATION,
    workerDispatchPolicy: ExternalWorkerDispatchPolicy.ALL_SELECTED_ATTEMPTS,
    phaseDispatch,
  });
  const base = testExecutionProfileDefinition(namespace);
  return Object.freeze({
    capability,
    profile: Object.freeze({
      ...base,
      id: executionProfileId(`profile_${namespace}-external-v3`),
      schemaVersion: 2,
      version: 'codeclosure-m2-5-1-real-codex-profile-v1',
      workerAdapter: 'trusted-external-worker',
      workerAdapterVersion: 'm2-5-1-v1',
      driverVersion: 'm2-5-1-driver-v1',
      externalExecution,
    }),
  });
}

function installAuthority(
  filename: string,
  namespace: string,
): Readonly<{
  profile: ExecutionProfileDefinition;
  profileDigest: string;
}> {
  const value = authority(namespace);
  const store = openSqliteControlStore({ filename, now: () => installedAt });
  const ids = new DeterministicIds(namespace);
  const capabilityInstall = store.installExternalBackendCapabilityRecord({
    record: value.capability,
    auditEventId: ids.nextAuditEventId(),
    payloadDigest: value.capability.recordDigest,
  });
  assert.equal(capabilityInstall.status, 'INSTALLED');
  const profileInstall = createExecutionProfileInstaller({
    store,
    clock: Object.freeze({ now: () => installedAt }),
    ids,
    digests,
  }).installExecutionProfile(value.profile);
  assert.equal(profileInstall.status, 'INSTALLED');
  const profileDigest = profileInstall.value.profile.digest;
  store.close();
  return Object.freeze({ profile: value.profile, profileDigest });
}

void test('[I-006][I-008][M251-V06] external-schema-compatibility installs, replays, and strictly reopens Profile v3', (t) => {
  const filename = temporaryDatabase(t, 'roundtrip');
  const installed = installAuthority(filename, 'external-v3-roundtrip');

  const reopened = openSqliteControlStore({ filename, now: () => installedAt });
  const retained = reopened.getExecutionProfile(installed.profile.id);
  assert.ok(retained !== undefined);
  assert.equal(retained.profile.digest, installed.profileDigest);
  assert.equal(retained.profile.schemaVersion, 2);
  assert.equal(retained.profile.externalExecution.schemaVersion, 3);
  const replay = createExecutionProfileInstaller({
    store: reopened,
    clock: Object.freeze({ now: () => installedAt }),
    ids: new DeterministicIds('external-v3-replay'),
    digests,
  }).installExecutionProfile(installed.profile);
  assert.equal(replay.status, 'EXISTING');
  reopened.close();

  const database = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    const row = database
      .prepare(
        `SELECT logical_schema_version, external_execution_json
           FROM external_execution_profile_extensions
          WHERE profile_id = ?`,
      )
      .get(installed.profile.id) as
      { logical_schema_version: number; external_execution_json: string } | undefined;
    assert.ok(row !== undefined);
    assert.equal(row.logical_schema_version, 2);
    assert.equal(
      decodeExternalExecutionProfileDefinition(JSON.parse(row.external_execution_json))
        .schemaVersion,
      3,
    );
  } finally {
    database.close();
  }
});

void test('[I-006][I-027] external Profile v3 requires exact capability configuration authority', (t) => {
  const filename = temporaryDatabase(t, 'capability-conflict');
  const value = authority('external-v3-capability-conflict');
  assert.equal(value.profile.schemaVersion, 2);
  assert.equal(value.profile.externalExecution.schemaVersion, 3);
  const store = openSqliteControlStore({ filename, now: () => installedAt });
  t.after(() => store.close());
  const ids = new DeterministicIds('external-v3-capability-conflict');
  assert.equal(
    store.installExternalBackendCapabilityRecord({
      record: value.capability,
      auditEventId: ids.nextAuditEventId(),
      payloadDigest: value.capability.recordDigest,
    }).status,
    'INSTALLED',
  );
  const mismatchedDefinition: ExecutionProfileDefinition = Object.freeze({
    ...value.profile,
    externalExecution: Object.freeze({
      ...value.profile.externalExecution,
      phaseDispatch: Object.freeze(
        value.profile.externalExecution.phaseDispatch.map((entry, index) =>
          index === 0
            ? Object.freeze({
                ...entry,
                configurationProfileDigest: digests.digest({ kind: 'substituted-config' }),
              })
            : entry,
        ),
      ),
    }),
  });
  const result = createExecutionProfileInstaller({
    store,
    clock: Object.freeze({ now: () => installedAt }),
    ids,
    digests,
  }).installExecutionProfile(mismatchedDefinition);
  assert.equal(result.status, 'PROFILE_CONFLICT');
  assert.equal(store.getExecutionProfile(value.profile.id), undefined);
  assert.equal(store.listAuditEvents('EXECUTION_PROFILE', value.profile.id).length, 0);
});

void test('[I-006][I-027] external Profile v3 rejects substituted phase contract authority', (t) => {
  const filename = temporaryDatabase(t, 'phase-contract-conflict');
  const value = authority('external-v3-phase-contract-conflict');
  assert.equal(value.profile.schemaVersion, 2);
  assert.equal(value.profile.externalExecution.schemaVersion, 3);
  const store = openSqliteControlStore({ filename, now: () => installedAt });
  t.after(() => store.close());
  const ids = new DeterministicIds('external-v3-phase-contract-conflict');
  assert.equal(
    store.installExternalBackendCapabilityRecord({
      record: value.capability,
      auditEventId: ids.nextAuditEventId(),
      payloadDigest: value.capability.recordDigest,
    }).status,
    'INSTALLED',
  );
  const mismatchedDefinition: ExecutionProfileDefinition = Object.freeze({
    ...value.profile,
    externalExecution: Object.freeze({
      ...value.profile.externalExecution,
      phaseDispatch: Object.freeze(
        value.profile.externalExecution.phaseDispatch.map((entry, index) =>
          index === 0
            ? Object.freeze({
                ...entry,
                responseContractDigest: digests.digest({ kind: 'substituted-response' }),
              })
            : entry,
        ),
      ),
    }),
  });
  const result = createExecutionProfileInstaller({
    store,
    clock: Object.freeze({ now: () => installedAt }),
    ids,
    digests,
  }).installExecutionProfile(mismatchedDefinition);
  assert.equal(result.status, 'PROFILE_CONFLICT');
  assert.equal(store.getExecutionProfile(value.profile.id), undefined);
  assert.equal(store.listAuditEvents('EXECUTION_PROFILE', value.profile.id).length, 0);
});

void test('[I-006][I-027] external Profile v3 install rejects a cross-phase response-schema policy', (t) => {
  const filename = temporaryDatabase(t, 'response-schema-conflict');
  const value = authority('external-v3-response-schema-conflict');
  assert.equal(value.profile.schemaVersion, 2);
  assert.equal(value.profile.externalExecution.schemaVersion, 3);
  const store = openSqliteControlStore({ filename, now: () => installedAt });
  t.after(() => store.close());
  const ids = new DeterministicIds('external-v3-response-schema-conflict');
  assert.equal(
    store.installExternalBackendCapabilityRecord({
      record: value.capability,
      auditEventId: ids.nextAuditEventId(),
      payloadDigest: value.capability.recordDigest,
    }).status,
    'INSTALLED',
  );
  const mismatchedDefinition: ExecutionProfileDefinition = Object.freeze({
    ...value.profile,
    externalExecution: Object.freeze({
      ...value.profile.externalExecution,
      phaseDispatch: Object.freeze(
        value.profile.externalExecution.phaseDispatch.map((entry) =>
          entry.phase === WorkflowPhase.DISCOVERY
            ? Object.freeze({
                ...entry,
                responseSchemaPolicy: ExternalPhaseResponseSchemaPolicy.COMPLETION_REQUEST_V1,
              })
            : entry,
        ),
      ),
    }),
  });
  assert.throws(() =>
    createExecutionProfileInstaller({
      store,
      clock: Object.freeze({ now: () => installedAt }),
      ids,
      digests,
    }).installExecutionProfile(mismatchedDefinition),
  );
  assert.equal(store.getExecutionProfile(value.profile.id), undefined);
  assert.equal(store.listAuditEvents('EXECUTION_PROFILE', value.profile.id).length, 0);
});

void test('[I-007][I-023][I-027] external Profile v3 rejects relative or overlapping roots', () => {
  const value = authority('external-v3-root-boundary');
  assert.equal(value.profile.schemaVersion, 2);
  assert.equal(value.profile.externalExecution.schemaVersion, 3);
  const external = value.profile.externalExecution;
  const discovery = external.phaseDispatch[0];
  assert.ok(discovery !== undefined);
  const withDiscovery = (entry: ExternalExecutionPhaseDispatchEntry) =>
    Object.freeze({
      ...external,
      phaseDispatch: Object.freeze([entry, ...external.phaseDispatch.slice(1)]),
    });
  assert.throws(
    () =>
      decodeExternalExecutionProfileDefinition(
        withDiscovery(Object.freeze({ ...discovery, allowedRoots: Object.freeze(['relative']) })),
      ),
    /exact normalized absolute path/u,
  );
  assert.throws(
    () =>
      decodeExternalExecutionProfileDefinition(
        withDiscovery(
          Object.freeze({
            ...discovery,
            allowedRoots: Object.freeze(['/authority/workspaces']),
            forbiddenRoots: Object.freeze(
              ['/authority/workspaces/private', external.controlledStateRootIdentity].toSorted(),
            ),
          }),
        ),
      ),
    /cannot overlap/u,
  );
});

void test('[I-007][I-023][I-027] external Profile v3 requires every phase to forbid control state', () => {
  const value = authority('external-v3-control-root');
  assert.equal(value.profile.schemaVersion, 2);
  assert.equal(value.profile.externalExecution.schemaVersion, 3);
  const external = value.profile.externalExecution;
  const phaseDispatch = Object.freeze(
    external.phaseDispatch.map((entry, index) =>
      index === 0
        ? Object.freeze({
            ...entry,
            forbiddenRoots: Object.freeze(
              entry.forbiddenRoots.filter((root) => root !== external.controlledStateRootIdentity),
            ),
          })
        : entry,
    ),
  );
  assert.throws(
    () => decodeExternalExecutionProfileDefinition(Object.freeze({ ...external, phaseDispatch })),
    /must forbid the controlled state root/u,
  );
});

void test('[I-006][I-027] strict reopen rejects retained v3 phase-order substitution', (t) => {
  const filename = temporaryDatabase(t, 'strict-reopen');
  const installed = installAuthority(filename, 'external-v3-strict-reopen');
  const database = new Database(filename, { fileMustExist: true });
  try {
    database.exec('DROP TRIGGER external_execution_profile_extensions_no_update');
    const row = database
      .prepare(
        'SELECT external_execution_json FROM external_execution_profile_extensions WHERE profile_id = ?',
      )
      .get(installed.profile.id) as { external_execution_json: string } | undefined;
    assert.ok(row !== undefined);
    const parsed = JSON.parse(row.external_execution_json) as Record<string, unknown>;
    parsed['workerPhases'] = [WorkflowPhase.DISCOVERY, WorkflowPhase.PLAN, WorkflowPhase.IMPLEMENT];
    database
      .prepare(
        'UPDATE external_execution_profile_extensions SET external_execution_json = ? WHERE profile_id = ?',
      )
      .run(JSON.stringify(parsed), installed.profile.id);
  } finally {
    database.close();
  }
  assert.throws(() => openSqliteControlStore({ filename, now: () => installedAt }));
});

void test('[I-006][I-027] strict reopen rejects retained v3 response-schema substitution', (t) => {
  const filename = temporaryDatabase(t, 'strict-reopen-response-schema');
  const installed = installAuthority(filename, 'external-v3-strict-reopen-response-schema');
  const database = new Database(filename, { fileMustExist: true });
  try {
    database.exec('DROP TRIGGER external_execution_profile_extensions_no_update');
    const row = database
      .prepare(
        'SELECT external_execution_json FROM external_execution_profile_extensions WHERE profile_id = ?',
      )
      .get(installed.profile.id) as { external_execution_json: string } | undefined;
    assert.ok(row !== undefined);
    const parsed = JSON.parse(row.external_execution_json) as Record<string, unknown>;
    const phaseDispatch = parsed['phaseDispatch'];
    assert.ok(Array.isArray(phaseDispatch));
    const dispatchEntries = phaseDispatch as readonly unknown[];
    const discovery = dispatchEntries[0];
    if (typeof discovery !== 'object' || discovery === null) {
      assert.fail('DISCOVERY phase dispatch entry was not retained as an object');
    }
    Reflect.set(
      discovery,
      'responseSchemaPolicy',
      ExternalPhaseResponseSchemaPolicy.COMPLETION_REQUEST_V1,
    );
    database
      .prepare(
        'UPDATE external_execution_profile_extensions SET external_execution_json = ? WHERE profile_id = ?',
      )
      .run(JSON.stringify(parsed), installed.profile.id);
  } finally {
    database.close();
  }
  assert.throws(() => openSqliteControlStore({ filename, now: () => installedAt }));
});
