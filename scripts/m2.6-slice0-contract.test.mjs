import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');
const contractPath = resolve(repositoryRoot, 'scripts/fixtures/m2.6/slice0-contract.json');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));

function source(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function unique(values, name) {
  assert.equal(new Set(values).size, values.length, `${name} must be unique`);
  return values;
}

function acceptanceRows() {
  return [
    ...source('docs/plans/m2.6-acceptance-plan.md').matchAll(/\| `(M26-[A-Z]\d{2})` \|/gu),
  ].map(([, row]) => row);
}

test('M26-S0-01 accepted identities budgets and proof owners are exact', () => {
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.contractId, 'codeclosure-m2-6-slice0-contract');
  assert.equal(contract.contractVersion, 'codeclosure-m2-6-slice0-v1');

  const protocol = JSON.parse(
    source('packages/codex-app-server-client/protocol/codex-schema-snapshot-v1.json'),
  );
  assert.deepEqual(contract.toolchain, {
    codexVersion: protocol.codex.version,
    snapshotProfile: protocol.snapshotProfile,
    snapshotDigest: protocol.snapshotDigest,
    launcherDigest: protocol.codex.launcherDigest,
    delegatedExecutableDigest: protocol.codex.delegatedExecutableDigest,
    typescriptDigest: protocol.typescript.digest,
    typescriptFileCount: protocol.typescript.fileCount,
    jsonSchemaDigest: protocol.jsonSchema.digest,
    jsonSchemaFileCount: protocol.jsonSchema.fileCount,
    feasibilityProbeDate: '2026-08-14',
    feasibilityMeaning: 'LOWER_CLIENT_ONLY_NOT_FRONTSTAGE_EVIDENCE',
  });

  assert.deepEqual(
    contract.decisions.map(({ adr, status }) => [adr, status]),
    [
      ['0036', 'Accepted'],
      ['0037', 'Accepted'],
      ['0038', 'Accepted'],
      ['0039', 'Accepted'],
    ],
  );
  for (const decision of contract.decisions) {
    assert.match(source(decision.path), /^- Status: Accepted$/mu);
    assert.match(
      source('docs/adr/README.md'),
      new RegExp(`^\\| \\[${decision.adr}\\].*\\| Accepted \\|$`, 'mu'),
    );
  }

  assert.deepEqual(contract.identities.assistantProfile.selectedAuthorityCapabilities, []);
  assert.equal(
    contract.identities.assistantProfile.effectPolicy,
    'ISOLATED_READ_ONLY_FAIL_ON_TOOL_OBSERVATION',
  );
  assert.equal(contract.identities.principal, 'principal_local-user');
  assert.equal(contract.identities.model.model, 'gpt-5.6-sol');
  assert.equal(contract.identities.model.reasoningEffort, 'low');

  assert.deepEqual(contract.budgets, {
    maximumUserMessageBytes: 16_384,
    maximumSessionMessages: 512,
    maximumSessionContentBytes: 2_097_152,
    maximumSelectedPriorMessages: 8,
    maximumSelectedPriorMessageBytes: 4_096,
    maximumSelectedPriorMessageContentBytes: 32_768,
    maximumGoalSummariesPerPackage: 20,
    maximumActiveQuestionBytes: 2_048,
    maximumCanonicalPackageBytes: 65_536,
    maximumManifestEntries: 64,
    maximumProposalResponseBytes: 32_768,
    maximumRetainedAnswerBytes: 16_384,
    maximumClarificationOrExplanationBytes: 2_048,
    maximumCandidateGoalIds: 4,
    assistantOperationDeadlineMilliseconds: 120_000,
    maximumNotificationQueueEntries: 64,
    gracefulShutdownDeadlineMilliseconds: 10_000,
    retentionLimitDisposition: 'CLOSED_WITH_RETENTION_LIMIT_REACHED_NO_EVICTION_OR_SUMMARY',
  });

  const rows = unique(acceptanceRows(), 'M2.6 acceptance rows');
  assert.equal(rows.length, 57);
  assert.deepEqual(Object.keys(contract.proofOwners), rows);
  for (const [row, owner] of Object.entries(contract.proofOwners)) {
    assert.equal(typeof owner, 'string', `${row} proof owner must be a string`);
    assert.ok(owner.length > 20, `${row} proof owner must be exact`);
  }
});

test('M26-S0-02 grammar query lifecycle and migration remain bounded', () => {
  assert.equal(contract.grammar.locale, 'zh-CN');
  assert.equal(contract.grammar.normalization, 'NONE_EXACT_UNICODE_SCALAR_SEQUENCE');
  assert.deepEqual(
    contract.grammar.directActions.map(({ messageTemplate, result }) => [messageTemplate, result]),
    [
      ['请执行以下请求：<request>', 'SUBMIT_GOVERNED_INTAKE'],
      ['请仅创建目标：<request>', 'SUBMIT_MATERIALIZE_ONLY_INTAKE'],
      ['请开始当前目标', 'START_GOAL'],
      ['请继续当前目标', 'RESUME_GOAL'],
    ],
  );
  assert.deepEqual(contract.grammar.confirm, ['确认', '确认执行']);
  assert.deepEqual(contract.grammar.decline, ['不确认', '取消本次操作']);
  assert.equal(contract.grammar.plainCancelResult, 'UNCLEAR');

  assert.deepEqual(contract.contracts, {
    recordSchemaVersion: 1,
    canonicalization: 'RFC8785_JSON',
    unknownFields: 'REJECT',
    sessionStates: ['OPEN', 'CLOSING', 'CLOSED', 'INTERRUPTED'],
    operationStates: ['RESERVED', 'COMPLETED', 'FAILED', 'INTERRUPTED'],
    operationKinds: [
      'ROUTE',
      'FRONTSTAGE_ANSWER',
      'GOAL_LIST',
      'GOAL_STATUS',
      'INTAKE_HANDOFF',
      'INTAKE_CLARIFICATION',
      'ACTION_PROPOSAL',
      'ACTION_CONFIRMATION',
      'RESULT_PROJECTION',
    ],
    focusKinds: ['NONE', 'INTAKE_QUESTION', 'GOAL'],
    routeDecisionOutcomes: [
      'ANSWER',
      'LIST_GOALS',
      'SHOW_GOAL',
      'CONTINUE_EXACT_INTAKE_QUESTION',
      'PROPOSE_INTAKE_ACTION',
      'PROPOSE_GOAL_CONTROL',
      'ASK_ROUTE_CLARIFICATION',
      'NO_ACTION',
    ],
    pendingActionKinds: [
      'SUBMIT_GOVERNED_INTAKE',
      'SUBMIT_MATERIALIZE_ONLY_INTAKE',
      'START_GOAL',
      'RESUME_GOAL',
      'CANCEL_GOAL',
    ],
    confirmationRequirements: ['DIRECT_USER_MESSAGE_SUFFICIENT', 'SEPARATE_RESPONSE_REQUIRED'],
    pendingActionResolutionDispositions: [
      'DIRECT_USER_AUTHORIZED',
      'SEPARATE_RESPONSE_CONFIRMED',
      'DECLINED',
      'UNCLEAR',
      'EXPIRED',
      'STALE_AUTHORITY',
      'CONFLICT',
      'INTERRUPTED',
    ],
    proposalVariants: {
      ANSWER_PROPOSAL: ['answerContent'],
      ROUTE_PROPOSAL: ['candidateRoute', 'candidateGoalIds', 'ambiguity', 'explanationContent?'],
      CLARIFICATION_PROPOSAL: ['ambiguity', 'questionContent'],
      NO_ACTION_PROPOSAL: ['reasonCode'],
    },
    candidateRoutes: [
      'LIST_GOALS',
      'SHOW_GOAL',
      'SUBMIT_GOVERNED_INTAKE',
      'SUBMIT_MATERIALIZE_ONLY_INTAKE',
      'START_GOAL',
      'RESUME_GOAL',
      'CANCEL_GOAL',
    ],
    proposalAmbiguities: ['NONE', 'ACTION_AMBIGUOUS', 'TARGET_AMBIGUOUS', 'REQUEST_INCOMPLETE'],
    noActionReasonCodes: ['UNSUPPORTED', 'NO_SAFE_PROPOSAL'],
  });
  assert.deepEqual(contract.goalSummary, {
    filters: ['OPEN', 'ALL'],
    defaultFilter: 'OPEN',
    openGoalStatuses: ['ACTIVE', 'WAITING_FOR_INPUT', 'BLOCKED'],
    defaultPageSize: 20,
    maximumPageSize: 50,
    objectiveLabelMaximumBytes: 256,
    ordering: ['LAST_AUTHORITATIVE_CHANGE_AT_DESC', 'GOAL_ID_ASC'],
    watermark: 'LATEST_GOAL_OWNED_AUDIT_SEQUENCE_FOR_EXACT_PROJECT',
    changedWatermarkDisposition: 'STALE_CURSOR',
  });
  assert.deepEqual(contract.lifecycle, {
    startupSessionSelection: 'ALWAYS_NEW_AFTER_RECONCILIATION',
    importPriorMessageOrFocusContext: false,
    maximumSessionExecutionTasks: 1,
    busyStartOrResumeDisposition: 'SESSION_EXECUTION_BUSY',
    busyGovernedAlternative: 'SAME_MESSAGE_MATERIALIZE_ONLY_SEPARATE_RESPONSE_REQUIRED',
    busyCancellationTarget: 'ACTIVE_SESSION_GOAL_ONLY_SEPARATE_RESPONSE_REQUIRED',
    delayedExecutionQueue: false,
    projectWideExecutionSlot: false,
    shutdownInterruptionCapability: 'interruptOwnedExecution',
    gracefulExitCode: 0,
    deadlineExitCode: 4,
    infrastructureExitCode: 5,
    deadlineState: 'CLOSING',
  });
  assert.deepEqual(contract.persistence, {
    firstMigration: '0037_frontstage_interaction.sql',
    historicalRewrite: false,
    stateAndAuditAtomic: true,
    authorizedRecovery: 'SAME_PUBLIC_COMMAND_ID_AND_CANONICAL_INPUT_ONLY',
    assistantRecovery: 'TERMINALIZE_WITHOUT_RECALL',
  });

  const plan = source('docs/plans/m2.6-unified-frontstage-interaction.md');
  const adr36 = source('docs/adr/0036-trusted-natural-language-interaction-routing.md');
  const frontstage = source('docs/frontstage-interaction.md');
  const adr39 = source('docs/adr/0039-cli-resident-frontstage-lifecycle-and-concurrency.md');
  for (const action of contract.grammar.directActions) {
    assert.ok(adr36.includes(`\`${action.messageTemplate}\``));
  }
  for (const phrase of [...contract.grammar.confirm, ...contract.grammar.decline]) {
    assert.ok(adr36.includes(`\`${phrase}\``));
  }
  for (const identity of Object.values(contract.identities)) {
    if (typeof identity === 'object' && identity !== null && 'id' in identity) {
      assert.ok(plan.includes(`\`${identity.id}\``));
      if ('version' in identity) {
        assert.ok(plan.includes(`\`${identity.version}\``));
      }
    }
  }
  assert.ok(adr39.includes('`10_000` milliseconds'));
  for (const operationKind of contract.contracts.operationKinds) {
    assert.ok(frontstage.includes(`\`${operationKind}\``));
  }
  assert.ok(plan.includes('`0037_frontstage_interaction.sql`'));
  assert.doesNotMatch(JSON.stringify(contract), /FakeWorker|Runtime Host|automatic scheduler/u);
});
