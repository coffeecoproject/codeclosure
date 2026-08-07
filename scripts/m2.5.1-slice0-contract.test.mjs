import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
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

function sha256(relativePath) {
  return `sha256:${createHash('sha256')
    .update(readFileSync(resolve(repositoryRoot, relativePath)))
    .digest('hex')}`;
}

test('M251-S0-01 identity and schema freeze is exact and excludes Fake composition', () => {
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.contractVersion, 'codeclosure-m2-5-1-slice0-v2');
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
  });
  assert.match(
    source('packages/codex-app-server-client/src/protocol/v2/Model.ts'),
    /modelSpecialty: string \| null/u,
  );
  assert.equal(contract.intake.assistantProfile.schemaVersion, 2);
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
  assert.doesNotMatch(
    JSON.stringify(contract.execution),
    /FakeWorker|FakeCandidate|FakeVerification/u,
  );

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
      fileChange: 'REJECT_DISCARD_RESULT',
      maintenanceCompaction: 'ADMIT_SEPARATE_MAINTENANCE_ONLY',
      forbiddenOrUnknown: 'REJECT_DISCARD_RESULT',
    },
    IMPLEMENT: {
      lifecycle: 'ADMIT_NON_AUTHORITATIVE',
      commandExecution: 'ADMIT_CANDIDATE_BOUND',
      fileChange: 'ADMIT_CANDIDATE_ALLOWED_PATHS',
      maintenanceCompaction: 'ADMIT_SEPARATE_MAINTENANCE_ONLY',
      forbiddenOrUnknown: 'REJECT_DISCARD_RESULT',
    },
    PLAN: {
      lifecycle: 'ADMIT_NON_AUTHORITATIVE',
      commandExecution: 'ADMIT_SNAPSHOT_READ_ONLY',
      fileChange: 'REJECT_DISCARD_RESULT',
      maintenanceCompaction: 'ADMIT_SEPARATE_MAINTENANCE_ONLY',
      forbiddenOrUnknown: 'REJECT_DISCARD_RESULT',
    },
  });

  const intakeContracts = source('packages/runtime/src/intake-assistant.ts');
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
  assert.equal(uniqueRowIds.length, 67);
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
  assert.equal(sha256(check.assetPath), check.assetDigest);
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
