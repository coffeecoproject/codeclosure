import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import process from 'node:process';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');
const contractPath = resolve(repositoryRoot, 'scripts/fixtures/m2.5.1/slice0-contract.json');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));

function source(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function sortedUnique(values, name) {
  const sorted = [...values].sort();
  assert.equal(new Set(values).size, values.length, `${name} must be unique`);
  return sorted;
}

function assertStringSorted(values, name) {
  assert.deepEqual(values, [...values].sort(), `${name} must be string-sorted`);
}

function executableProofMarkerLine(sourceText, marker) {
  return sourceText.split('\n').find((line) => {
    const trimmed = line.trimStart();
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('import ')
    ) {
      return false;
    }
    const markerIndex = line.indexOf(marker);
    return markerIndex >= 0 && /['"`]/u.test(line.slice(0, markerIndex));
  });
}

function notificationMethods() {
  const protocolSurface = source('packages/codex-app-server-client/src/protocol-surface.ts');
  const start = protocolSurface.indexOf('generatedServerNotificationMethods');
  const end = protocolSurface.indexOf('generatedServerRequestMethods');
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return [...protocolSurface.slice(start, end).matchAll(/^ {2}"([^"]+)",?$/gmu)].map(
    ([, method]) => method,
  );
}

function threadItemKinds() {
  const threadItem = source('packages/codex-app-server-client/src/protocol/v2/ThreadItem.ts');
  return [...threadItem.matchAll(/"type": "([^"]+)"/gu)].map(([, kind]) => kind);
}

function responseItemKinds() {
  const responseItem = source('packages/codex-app-server-client/src/protocol/ResponseItem.ts');
  return [...responseItem.matchAll(/"type": "([^"]+)"/gu)].map(([, kind]) => kind);
}

function sha256(relativePath) {
  return `sha256:${createHash('sha256')
    .update(readFileSync(resolve(repositoryRoot, relativePath)))
    .digest('hex')}`;
}

test('M251-S0-01 identity and schema freeze is exact and excludes Fake composition', () => {
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.contractVersion, 'codeclosure-m2-5-1-slice0-v7');
  const protocolManifest = JSON.parse(
    source('packages/codex-app-server-client/protocol/codex-schema-snapshot-v1.json'),
  );
  assert.deepEqual(contract.toolchain.selected, {
    codexVersion: protocolManifest.codex.version,
    snapshotProfile: protocolManifest.snapshotProfile,
    snapshotDigest: protocolManifest.snapshotDigest,
    launcherDigest: protocolManifest.codex.launcherDigest,
    delegatedExecutableDigest: protocolManifest.codex.delegatedExecutableDigest,
    typescriptDigest: protocolManifest.typescript.digest,
    typescriptFileCount: protocolManifest.typescript.fileCount,
    jsonSchemaDigest: protocolManifest.jsonSchema.digest,
    jsonSchemaFileCount: protocolManifest.jsonSchema.fileCount,
  });
  assert.deepEqual(contract.toolchain.retainedHistorical, {
    codexVersion: 'codex-cli 0.146.0',
    snapshotProfile: 'codex-schema-snapshot-v1',
    snapshotDigest: 'sha256:0b0bdf534386d796c41596693c451aabaec2526bbac5a7965ab558edc3de8e21',
    launcherDigest: 'sha256:134063e133f0b4244fa3b251acf973d4fe4b4aeeacbdc135211bf480f59f1477',
    delegatedExecutableDigest:
      'sha256:ae1d3ffe6d48aec6a4dc3f50e7eb8e0d11962485a6a9406c5a7012139383da02',
    typescriptDigest: 'sha256:63c7a5d3d92b1ba1218d92711a81c39bf5b2ee60d978736166615efe5f947684',
    typescriptFileCount: 622,
    jsonSchemaDigest: 'sha256:9c13d0c5385a5eeeed6b0f4f59e7b3b91ca07db451ee78724756d87b6f84e50e',
    jsonSchemaFileCount: 275,
  });
  assert.notEqual(
    contract.toolchain.selected.snapshotDigest,
    contract.toolchain.retainedHistorical.snapshotDigest,
  );
  assert.deepEqual(contract.toolchain.reviewedProtocolDelta, {
    generatedTypescriptPaths: ['v2/Model.ts'],
    generatedJsonSchemaPaths: [
      'codex_app_server_protocol.schemas.json',
      'codex_app_server_protocol.v2.schemas.json',
      'v2/ModelListResponse.json',
    ],
    modelFieldAddition: 'modelSpecialty: string | null',
    clientMethodSurfaceChanged: false,
    serverNotificationSurfaceChanged: false,
    serverRequestSurfaceChanged: false,
    threadItemSurfaceChanged: false,
    responseItemSurfaceChanged: false,
  });
  assert.match(
    source('packages/codex-app-server-client/src/protocol/v2/Model.ts'),
    /modelSpecialty: string \| null/u,
  );
  assert.equal(contract.intake.assistantProfile.schemaVersion, 3);
  assert.equal(contract.execution.executionProfile.schemaVersion, 2);
  assert.equal(contract.execution.externalExecutionProfileDefinitionSchemaVersion, 3);
  assert.equal(contract.execution.externalExecutionIntentSchemaVersion, 2);
  assert.equal(contract.execution.externalExecutionRecordSchemaVersion, 2);
  assert.equal(contract.execution.codexWorkerDirectiveSchemaVersion, 3);
  assert.equal(contract.execution.codexAdapterObservationSchemaVersion, 2);
  assert.equal(contract.execution.contextPackageSchemaVersion, 5);
  assert.equal(contract.execution.contextManifestSchemaVersion, 5);
  assert.deepEqual(contract.execution.phaseOrder, ['DISCOVERY', 'IMPLEMENT', 'PLAN']);
  assert.deepEqual(Object.keys(contract.execution.phaseDispatch), contract.execution.phaseOrder);
  assert.deepEqual(
    Object.keys(contract.execution.workerActivityDispositions),
    contract.execution.phaseOrder,
  );
  assert.deepEqual(contract.execution.workflowExecutionOrder, ['DISCOVERY', 'PLAN', 'IMPLEMENT']);
  assert.equal(contract.execution.workerDispatchPolicy, 'ALL_SELECTED_ATTEMPTS');
  assert.deepEqual(contract.execution.projectReadDirectiveBinding, {
    authorityInput: 'FULL_RETAINED_PROJECT_SOURCE_READ_AUTHORITY_RECORD_V1',
    digestValidation: 'RECOMPUTE_CANONICAL_RECORD_DIGEST',
    resultProjection: 'ID_DIGEST_CWD_ONLY',
  });
  assert.deepEqual(contract.execution.effectiveRootPolicy, {
    allowed: 'PHASE_SOURCE_INTERSECTION',
    forbidden: 'PHASE_SOURCE_UNION',
  });
  assert.deepEqual(contract.execution.workerEffectiveConfigurationPolicy, {
    featureProjection: 'EXACT_CODEX_0_146_1_CONFIG_READ',
    implicitDisabledFeatures: ['remote_control'],
    instructionAndToolOverrides: 'NULL',
  });
  assert.doesNotMatch(
    JSON.stringify(contract.execution),
    /FakeWorker|FakeCandidate|FakeVerification/u,
  );
  const projectReadContractSources = [
    source('packages/domain/src/project-read.ts'),
    source('packages/domain/src/project-read-cleanup.ts'),
    source('packages/runtime/src/project-read-workspace-contracts.ts'),
    source('packages/runtime/src/project-read-snapshot-cleanup-contracts.ts'),
  ].join('\n');
  for (const schemaName of Object.values(contract.execution.projectReadSchemas)) {
    assert.match(
      projectReadContractSources,
      new RegExp(`export (?:interface|type) ${schemaName}\\b`, 'u'),
      `${schemaName} must remain an exact exported contract identity`,
    );
  }
  const workerContracts = source('packages/adapter-codex/src/m251-contracts.ts');
  const workerActivityPolicy = source('packages/adapter-codex/src/m251-activity-policy.ts');
  assert.match(workerContracts, /authorityRecord: ProjectSourceReadAuthorityRecord/u);
  assert.match(workerContracts, /decodeProjectSourceReadAuthorityRecord/u);
  assert.match(workerContracts, /projectSourceReadAuthorityProjection/u);
  assert.match(workerContracts, /remote_control: false/u);
  assert.match(workerActivityPolicy, /source\.authorityRecord\.forbiddenRoots/u);

  const discovery = contract.execution.phaseDispatch.DISCOVERY;
  const plan = contract.execution.phaseDispatch.PLAN;
  const implement = contract.execution.phaseDispatch.IMPLEMENT;
  for (const phase of [discovery, plan]) {
    assert.equal(phase.workerMode, 'REAL_CODEX');
    assert.equal(phase.cwdKind, 'PROJECT_READ_SNAPSHOT');
    assert.equal(phase.projectReadSnapshotAuthority, 'REQUIRED');
    assert.equal(phase.candidateWorkspaceLease, 'FORBIDDEN');
    assert.deepEqual(phase.responseContract, {
      schemaVersion: 1,
      workerEventSchemaVersion: 1,
      allowedResultKinds: ['PROPOSALS'],
      unknownFields: 'REJECT',
      maxEventBytes: 65_536,
    });
    assert.equal(phase.canonicalDomainGrant.projectRead, true);
    assert.equal(phase.canonicalDomainGrant.candidateAccess, 'NONE');
    assert.equal(phase.canonicalDomainGrant.controlSubmission, 'PROPOSALS');
    assert.equal(phase.canonicalDomainGrant.acceptanceAccess, 'NONE');
    assert.deepEqual(phase.canonicalDomainGrant.allowedActions, [
      'READ_PROJECT',
      'WRITE_RUN_OUTPUT',
      'SUBMIT_PROPOSALS',
    ]);
  }
  assert.equal(implement.workerMode, 'REAL_CODEX');
  assert.equal(implement.cwdKind, 'CANDIDATE_WORKSPACE');
  assert.equal(implement.projectReadSnapshotAuthority, 'FORBIDDEN');
  assert.equal(implement.candidateWorkspaceLease, 'REQUIRED');
  assert.deepEqual(implement.responseContract, {
    schemaVersion: 1,
    workerEventSchemaVersion: 1,
    allowedResultKinds: ['COMPLETION_REQUEST'],
    unknownFields: 'REJECT',
    maxEventBytes: 65_536,
  });
  assert.equal(implement.canonicalDomainGrant.projectRead, true);
  assert.equal(implement.canonicalDomainGrant.candidateAccess, 'MUTABLE_WRITE');
  assert.equal(implement.canonicalDomainGrant.runOutputScope, 'BOUNDED_IMPLEMENTATION');
  assert.equal(implement.canonicalDomainGrant.controlSubmission, 'COMPLETION_REQUEST');
  assert.equal(implement.canonicalDomainGrant.acceptanceAccess, 'NONE');
  assert.deepEqual(implement.canonicalDomainGrant.allowedActions, [
    'READ_PROJECT',
    'READ_CANDIDATE',
    'WRITE_CANDIDATE_SOURCE',
    'WRITE_RUN_OUTPUT',
    'SUBMIT_COMPLETION_REQUEST',
  ]);
  assert.equal(discovery.canonicalDomainGrant.runOutputScope, 'BOUNDED_DISCOVERY');
  assert.equal(plan.canonicalDomainGrant.runOutputScope, 'PLAN_OBSERVATION');
  assert.deepEqual(contract.execution.workerActivityDispositions, {
    DISCOVERY: {
      lifecycle: 'ADMIT_NON_AUTHORITATIVE',
      commandExecution: 'ADMIT_SNAPSHOT_READ_ONLY',
      bestEffortUnknownCommandAction: 'REJECT_DISCARD_RESULT',
      fileChange: 'REJECT_DISCARD_RESULT',
      maintenanceCompaction: 'ADMIT_SEPARATE_MAINTENANCE_ONLY',
      forbiddenOrUnknown: 'REJECT_DISCARD_RESULT',
    },
    IMPLEMENT: {
      lifecycle: 'ADMIT_NON_AUTHORITATIVE',
      commandExecution: 'ADMIT_CANDIDATE_BOUND',
      bestEffortUnknownCommandAction: 'REJECT_UNTIL_FREEZE_V2_COMPOSED_THEN_ADMIT_CANDIDATE_BOUND',
      fileChange: 'ADMIT_CANDIDATE_ALLOWED_PATHS',
      maintenanceCompaction: 'ADMIT_SEPARATE_MAINTENANCE_ONLY',
      forbiddenOrUnknown: 'REJECT_DISCARD_RESULT',
    },
    PLAN: {
      lifecycle: 'ADMIT_NON_AUTHORITATIVE',
      commandExecution: 'ADMIT_SNAPSHOT_READ_ONLY',
      bestEffortUnknownCommandAction: 'REJECT_DISCARD_RESULT',
      fileChange: 'REJECT_DISCARD_RESULT',
      maintenanceCompaction: 'ADMIT_SEPARATE_MAINTENANCE_ONLY',
      forbiddenOrUnknown: 'REJECT_DISCARD_RESULT',
    },
  });
  assert.deepEqual(contract.execution.candidateFreezeChangeContainment, {
    requestSchemaVersion: 2,
    observationSchemaVersion: 2,
    evidenceObservationSchemaVersion: 2,
    changeSetProfile: 'candidate-change-set-v2',
    maximumChangeEntries: 8_192,
    observationOwner: 'CANDIDATE_MANAGER_SOURCE_FREEZE',
    allowedPathDispositionOwner: 'WORKFLOW_RUNTIME_WITH_STORE_BACKSTOP',
    historicalSchemaVersion: 1,
    activation: 'REQUIRED_BEFORE_IMPLEMENT_UNKNOWN_COMMAND_ACTION',
  });

  const intakeContracts = source('packages/runtime/src/intake-assistant.ts');
  for (const identity of Object.values(contract.intake.retainedSlice1Identities)) {
    assert.ok(intakeContracts.includes(identity.id));
    assert.ok(intakeContracts.includes(identity.version));
  }
  assert.ok(intakeContracts.includes(contract.intake.instructionPolicy.id));
  assert.ok(intakeContracts.includes(contract.intake.instructionPolicy.version));
  assert.ok(intakeContracts.includes(contract.intake.intentAnalysisResponseContract.id));
  assert.ok(intakeContracts.includes(contract.intake.intentAnalysisResponseContract.version));
  assert.ok(
    source('packages/domain/src/intake.ts').includes(
      contract.intake.intentProjectionProfileVersion,
    ),
  );
  for (const identity of Object.values(contract.intake.unchangedIdentities)) {
    if (typeof identity === 'object') {
      assert.ok(intakeContracts.includes(identity.id));
      assert.ok(intakeContracts.includes(identity.version));
    }
  }
});

test('M251-S0-02 pinned notification and Item dispositions are exhaustive and disjoint', () => {
  const methods = notificationMethods();
  assert.equal(methods.length, 72);
  const mappedMethods = Object.values(contract.intake.notificationMethodDispositions).flat();
  assert.deepEqual(sortedUnique(mappedMethods, 'notification method mapping'), methods);
  for (const [disposition, dispositionMethods] of Object.entries(
    contract.intake.notificationMethodDispositions,
  )) {
    assertStringSorted(dispositionMethods, `${disposition} notification methods`);
  }

  const itemKinds = threadItemKinds().sort();
  const mappedItemKinds = Object.values(contract.intake.threadItemDispositions).flat();
  assert.deepEqual(sortedUnique(mappedItemKinds, 'Thread Item mapping'), itemKinds);
  for (const [disposition, dispositionKinds] of Object.entries(
    contract.intake.threadItemDispositions,
  )) {
    assertStringSorted(dispositionKinds, `${disposition} Thread Item kinds`);
  }

  const rawResponseItemKinds = responseItemKinds().sort();
  const mappedRawResponseItemKinds = Object.values(
    contract.intake.rawResponseItemDispositions,
  ).flat();
  assert.deepEqual(
    sortedUnique(mappedRawResponseItemKinds, 'Raw Response Item mapping'),
    rawResponseItemKinds,
  );
  for (const [disposition, dispositionKinds] of Object.entries(
    contract.intake.rawResponseItemDispositions,
  )) {
    assertStringSorted(dispositionKinds, `${disposition} Raw Response Item kinds`);
  }
  assert.deepEqual(contract.intake.rawResponseMessageRoles, ['assistant']);

  sortedUnique(contract.intake.normalizedEventKinds, 'normalized event kinds');
  assertStringSorted(contract.intake.normalizedEventKinds, 'normalized event kinds');
  sortedUnique(contract.intake.safeDiagnosticCategories, 'safe diagnostic categories');
  assertStringSorted(contract.intake.safeDiagnosticCategories, 'safe diagnostic categories');
});

test('M251-S0-03 every acceptance row has one exact proof owner', () => {
  const acceptancePlan = source('docs/plans/m2.5.1-acceptance-plan.md');
  const rawContract = source('scripts/fixtures/m2.5.1/slice0-contract.json');
  const rowIds = [...acceptancePlan.matchAll(/`(M251-[A-Z][0-9]{2})`/gu)].map(([, rowId]) => rowId);
  const writtenProofOwnerIds = [...rawContract.matchAll(/^ {4}"(M251-[A-Z][0-9]{2})":/gmu)].map(
    ([, rowId]) => rowId,
  );
  const uniqueRowIds = [...new Set(rowIds)].sort();
  assert.equal(uniqueRowIds.length, 68);
  assert.equal(
    new Set(writtenProofOwnerIds).size,
    writtenProofOwnerIds.length,
    'proof owner keys must not be duplicated in JSON source',
  );
  assert.deepEqual(Object.keys(contract.proofOwners).sort(), uniqueRowIds);
  for (const [rowId, owner] of Object.entries(contract.proofOwners)) {
    assert.match(rowId, /^M251-[A-Z][0-9]{2}$/u);
    assert.equal(typeof owner, 'string');
    assert.notEqual(owner.trim(), '');
    assert.match(owner, /#/u);
  }
});

test('M251-S3-01 implemented deterministic Slice 3 proof owners resolve exactly', () => {
  assert.equal(
    executableProofMarkerLine("// register('phase-dispatch-v3')", 'phase-dispatch-v3'),
    undefined,
  );
  assert.equal(
    executableProofMarkerLine("import './m2.5.1-phase-dispatch-v3.proof.ts'", 'phase-dispatch-v3'),
    undefined,
  );
  assert.notEqual(
    executableProofMarkerLine(
      "registerM251PhaseDispatchV3Proof('phase-dispatch-v3')",
      'phase-dispatch-v3',
    ),
    undefined,
  );
  const implementedRows = [
    'M251-V06',
    ...Array.from({ length: 11 }, (_, index) => `M251-C${String(index + 1).padStart(2, '0')}`),
    'M251-X03',
    'M251-X09',
    'M251-X10',
    'M251-X11',
    ...Array.from({ length: 8 }, (_, index) => `M251-F${String(index + 4).padStart(2, '0')}`),
  ];
  for (const rowId of implementedRows) {
    const owner = contract.proofOwners[rowId];
    assert.equal(typeof owner, 'string', `${rowId} must retain its frozen proof owner`);
    const separator = owner.indexOf('#');
    const ownerPath = owner.slice(0, separator);
    const marker = owner.slice(separator + 1);
    assert.match(ownerPath, /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u);
    assert.match(marker, /^[a-z0-9.-]+$/u);
    const resolvedOwner = resolve(repositoryRoot, ownerPath);
    assert.equal(
      resolvedOwner.startsWith(`${repositoryRoot}${sep}`),
      true,
      `${rowId} owner must stay inside the repository`,
    );
    const stat = lstatSync(resolvedOwner);
    assert.equal(stat.isFile(), true, `${rowId} owner must be a regular file`);
    assert.equal(stat.isSymbolicLink(), false, `${rowId} owner must not be a symbolic link`);
    assert.equal(
      realpathSync(resolvedOwner),
      resolvedOwner,
      `${rowId} owner must use its real path`,
    );
    const executableMarkerLine = executableProofMarkerLine(source(ownerPath), marker);
    assert.notEqual(
      executableMarkerLine,
      undefined,
      `${rowId} marker must participate in executable owner registration`,
    );
  }
});

test('M251-S0-04 unchanged lifecycle and Worker schemas already bind changed authority transitively', () => {
  const workerContracts = source('packages/runtime/src/worker-contracts.ts');
  const externalExecution = source('packages/domain/src/external-execution.ts');
  for (const field of [
    'contextManifestId',
    'contextManifestDigest',
    'packageDigest',
    'executionProfileId',
    'executionProfileDigest',
  ]) {
    assert.match(workerContracts, new RegExp(`readonly ${field}:`, 'u'));
  }
  assert.match(workerContracts, /export interface WorkerRequest[\s\S]*schemaVersion: 2;/u);
  assert.match(workerContracts, /interface WorkerEventBase[\s\S]*schemaVersion: 1;/u);
  assert.match(workerContracts, /interface WorkerEventReceiptBase[\s\S]*schemaVersion: 1;/u);
  assert.match(
    externalExecution,
    /export interface ExternalExecutionObservation[\s\S]*schemaVersion: 1;[\s\S]*intentDigest:/u,
  );
  assert.deepEqual(contract.execution.unchangedSchemas, [
    'ExternalExecutionObservationV1',
    'WorkerEventReceiptV1',
    'WorkerEventV1',
    'WorkerRequestV2',
  ]);
});

test('M251-S0-05 protected payment check is exact, independent, and behavior-bound', (t) => {
  const check = contract.demonstration.protectedCheck;
  const productionContractSource = source(
    'apps/cli/src/composition/m251-trusted-production-composition.ts',
  );
  const productionExpectedResult =
    /export const M251_PAYMENT_DEMO_EXPECTED_RESULT =\s*'([^'\n]*)';/u.exec(
      productionContractSource,
    )?.[1];
  assert.equal(sha256(check.assetPath), check.assetDigest);
  assert.equal(
    contract.demonstration.expectedResult,
    'duplicate callback is ignored and returns status duplicate_ignored, one charge is retained for one order, and different orders remain independent',
  );
  assert.equal(productionExpectedResult, contract.demonstration.expectedResult);
  assert.deepEqual(contract.demonstration.allowedPaths, ['src/payment.js']);
  assert.deepEqual(contract.demonstration.selectedSourcePaths, [
    '.gitignore',
    'package.json',
    'pnpm-lock.yaml',
    'src/payment.js',
    'test/payment.test.js',
  ]);

  const root = mkdtempSync(resolve(tmpdir(), 'codeclosure-m251-protected-check-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const passingRoot = resolve(root, 'passing');
  const failingRoot = resolve(root, 'failing');
  for (const candidateRoot of [passingRoot, failingRoot]) {
    mkdirSync(resolve(candidateRoot, 'src'), { recursive: true });
    writeFileSync(resolve(candidateRoot, 'package.json'), '{"type":"module"}\n');
  }
  writeFileSync(
    resolve(passingRoot, 'src/payment.js'),
    `export class PaymentProcessor {
  #charges = [];
  #orders = new Set();
  processCallback({ orderId, amount }) {
    if (this.#orders.has(orderId)) return { status: 'duplicate_ignored' };
    this.#orders.add(orderId);
    this.#charges.push({ orderId, amount });
    return { status: 'charged' };
  }
  getCharges() { return [...this.#charges]; }
}\n`,
  );
  writeFileSync(
    resolve(failingRoot, 'src/payment.js'),
    `export class PaymentProcessor {
  #charges = [];
  processCallback({ orderId, amount }) {
    this.#charges.push({ orderId, amount });
    return { status: 'charged' };
  }
  getCharges() { return [...this.#charges]; }
}\n`,
  );

  const checker = resolve(repositoryRoot, check.assetPath);
  const passing = spawnSync(process.execPath, [checker, passingRoot], { encoding: 'utf8' });
  assert.equal(passing.status, 0, passing.stderr);
  const failing = spawnSync(process.execPath, [checker, failingRoot], { encoding: 'utf8' });
  assert.notEqual(failing.status, 0);
});
