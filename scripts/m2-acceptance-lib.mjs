import { createHash } from 'node:crypto';

export const M2AcceptanceOutcome = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
});

export const M2AcceptanceStage = Object.freeze({
  ENTRY: 'entry-conditions',
  SOURCE_OPENING: 'source-identity-opening',
  PROTOCOL: 'protocol-snapshot',
  QUALITY: 'quality-gate',
  M1_BLACK_BOX: 'm1-black-box',
  SCOPE_REVIEW: 'scope-review',
  PROTECTED_REPAIR: 'm2-protected-repair',
  FAILED_REPAIR: 'm2-protected-failed-repair',
  ADAPTER_FAILURE: 'm2-adapter-failure',
  LIVE_PREFLIGHT: 'm2-live-compatibility-preflight',
  LIVE_REPAIR_HANDOFF: 'm2-live-repair-handoff',
  LIVE_NATURAL: 'm2-live-natural-branch',
  SOURCE_CLOSING: 'source-identity-closing',
});

const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const matrixGroupCounts = Object.freeze({ A: 10, B: 11, C: 11, D: 10, E: 15, F: 11, G: 17, H: 8 });

function assertObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function assertString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function assertDigest(value, name) {
  const digest = assertString(value, name);
  if (!sha256Pattern.test(digest)) {
    throw new TypeError(`${name} must be a SHA-256 digest`);
  }
  return digest;
}

function assertArray(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`);
  }
  return value;
}

function expectedMatrixIds() {
  const identifiers = [];
  for (const [group, count] of Object.entries(matrixGroupCounts)) {
    for (let index = 1; index <= count; index += 1) {
      identifiers.push(`M2-${group}${String(index).padStart(2, '0')}`);
    }
  }
  return Object.freeze(identifiers);
}

export const M2_MANDATORY_MATRIX_IDS = expectedMatrixIds();

export function sha256Text(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

export function parseSourceIdentity(output) {
  const values = new Map();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^([^:]+): (.*)$/u.exec(line);
    if (match !== null) {
      values.set(match[1], match[2]);
    }
  }
  const required = [
    'Base Git revision',
    'Working tree state',
    'Source manifest schema',
    'Source manifest paths',
    'Source manifest digest',
    'Self-referential review exclusion',
  ];
  const missing = required.filter((field) => !values.has(field));
  if (missing.length !== 0) {
    throw new TypeError(`Source identity is missing: ${missing.join(', ')}`);
  }
  const pathCount = Number(values.get('Source manifest paths'));
  if (!Number.isSafeInteger(pathCount) || pathCount < 1) {
    throw new TypeError('Source manifest path count is invalid');
  }
  const digest = values.get('Source manifest digest');
  assertDigest(digest, 'Source manifest digest');
  return Object.freeze({
    baseGitRevision: values.get('Base Git revision'),
    workingTreeState: values.get('Working tree state'),
    manifestSchema: values.get('Source manifest schema'),
    pathCount,
    digest,
    reviewExclusion: values.get('Self-referential review exclusion'),
  });
}

export function sourceIdentitiesMatch(opening, closing) {
  return JSON.stringify(opening) === JSON.stringify(closing);
}

export function parseAcceptanceMatrix(markdown) {
  const rows = [];
  const seen = new Set();
  for (const line of markdown.split(/\r?\n/u)) {
    const match = /^\| `(?<id>M2-[A-H]\d{2})` \| (?<proof>.*?) \| (?<evidence>.*?) \|$/u.exec(line);
    if (match?.groups === undefined) {
      continue;
    }
    const { id, proof, evidence } = match.groups;
    if (seen.has(id)) {
      throw new TypeError(`Duplicate M2 acceptance matrix row: ${id}`);
    }
    seen.add(id);
    rows.push(Object.freeze({ id, requiredProof: proof, primaryEvidence: evidence }));
  }
  const actual = rows.map(({ id }) => id);
  if (JSON.stringify(actual) !== JSON.stringify(M2_MANDATORY_MATRIX_IDS)) {
    throw new TypeError(
      `M2 acceptance matrix identifiers differ from the executable contract: ${actual.join(', ')}`,
    );
  }
  return Object.freeze(rows);
}

export function parseNodeTestSummaries(output) {
  const summaries = [];
  const pattern =
    /Node tests: PASS \((\d+)\/(\d+); fail=(\d+), cancelled=(\d+), skipped=(\d+), todo=(\d+)\)/gu;
  for (const match of output.matchAll(pattern)) {
    const summary = Object.freeze({
      pass: Number(match[1]),
      tests: Number(match[2]),
      fail: Number(match[3]),
      cancelled: Number(match[4]),
      skipped: Number(match[5]),
      todo: Number(match[6]),
    });
    if (
      summary.pass !== summary.tests ||
      summary.fail !== 0 ||
      summary.cancelled !== 0 ||
      summary.skipped !== 0 ||
      summary.todo !== 0
    ) {
      throw new TypeError('A passing M2 stage contains a non-passing Node test summary');
    }
    summaries.push(summary);
  }
  return Object.freeze(summaries);
}

function exactJsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateAudit(proof) {
  const audit = assertObject(proof.audit, 'Demo audit');
  if (audit.goalId !== proof.goalId) {
    throw new TypeError('Demo audit Goal identity differs from the proof');
  }
  const events = assertArray(audit.events, 'Demo audit events');
  if (events.length === 0 || !Number.isSafeInteger(audit.throughSequence)) {
    throw new TypeError('Demo audit must retain a non-empty bounded sequence');
  }
  let prior = 0;
  for (const rawEvent of events) {
    const event = assertObject(rawEvent, 'Demo audit event');
    if (
      !Number.isSafeInteger(event.sequence) ||
      event.sequence <= prior ||
      event.sequence > audit.throughSequence ||
      event.actorType !== 'RUNTIME'
    ) {
      throw new TypeError('Demo audit ordering or Runtime authorship is invalid');
    }
    assertDigest(event.payloadDigest, 'Demo audit payload digest');
    prior = event.sequence;
  }
  if (prior !== audit.throughSequence) {
    throw new TypeError('Demo audit does not end at its through-sequence');
  }
  return Object.freeze({ eventCount: events.length, throughSequence: audit.throughSequence });
}

function validateEvidence(m2, expectedResults) {
  const evidence = assertArray(m2.evidence, 'M2 Evidence');
  const observedResults = evidence.map((raw) => assertObject(raw, 'M2 Evidence item').result);
  if (!exactJsonEqual(observedResults, expectedResults)) {
    throw new TypeError(
      `M2 Evidence results ${JSON.stringify(observedResults)} differ from ${JSON.stringify(expectedResults)}`,
    );
  }
  return Object.freeze(
    evidence.map((raw) => {
      const item = assertObject(raw, 'M2 Evidence item');
      return Object.freeze({
        candidateGenerationId: assertString(
          item.candidateGenerationId,
          'M2 Evidence Candidate generation ID',
        ),
        candidateDigest: assertDigest(item.candidateDigest, 'M2 Evidence Candidate digest'),
        checkId: assertString(item.checkId, 'M2 Evidence Check ID'),
        evidenceDigest: assertDigest(item.evidenceDigest, 'M2 Evidence record digest'),
        result: item.result,
      });
    }),
  );
}

function validateAcceptanceTrace(m2, expected, evidence) {
  const trace = assertObject(m2.acceptanceTrace, 'M2 acceptance trace');
  if (trace.schemaVersion !== 1) {
    throw new TypeError('M2 acceptance trace schema is unsupported');
  }
  const plan = assertObject(trace.plan, 'M2 acceptance trace Plan');
  if (plan.id !== m2.planId || plan.digest !== m2.planDigest) {
    throw new TypeError('M2 acceptance trace Plan differs from the public Plan reference');
  }
  assertDigest(plan.digest, 'M2 acceptance trace Plan digest');
  assertDigest(
    plan.protectedAssetManifestDigest,
    'M2 acceptance trace protected-asset manifest digest',
  );
  const assets = assertArray(plan.protectedAssets, 'M2 acceptance trace protected assets');
  if (assets.length !== 1) {
    throw new TypeError('The bounded M2 acceptance trace must contain exactly one protected asset');
  }
  for (const rawAsset of assets) {
    const asset = assertObject(rawAsset, 'M2 acceptance trace protected asset');
    assertString(asset.logicalAssetId, 'M2 protected asset logical ID');
    assertString(asset.executionPath, 'M2 protected asset execution path');
    assertDigest(asset.contentDigest, 'M2 protected asset content digest');
    if (asset.protectionMode !== 'OUTSIDE_WORKER_WRITABLE_CANDIDATE') {
      throw new TypeError('M2 protected asset is not outside Worker authority');
    }
  }
  const semanticCheck = assertObject(plan.semanticCheck, 'M2 semantic protected Check');
  assertString(semanticCheck.version, 'M2 semantic Check version');
  assertDigest(semanticCheck.executableDigest, 'M2 semantic Check executable digest');
  assertDigest(semanticCheck.isolationProfileDigest, 'M2 isolation profile digest');

  const tracedVerification = assertArray(trace.verification, 'M2 traced verification');
  if (tracedVerification.length !== evidence.length) {
    throw new TypeError('M2 acceptance trace verification count differs from public Evidence');
  }
  for (const [index, rawVerification] of tracedVerification.entries()) {
    const verification = assertObject(rawVerification, 'M2 traced verification item');
    const publicEvidence = evidence[index];
    if (
      verification.candidateGenerationId !== publicEvidence.candidateGenerationId ||
      verification.candidateDigest !== publicEvidence.candidateDigest ||
      verification.checkId !== publicEvidence.checkId ||
      verification.evidenceDigest !== publicEvidence.evidenceDigest ||
      verification.result !== publicEvidence.result
    ) {
      throw new TypeError('M2 traced verification differs from public Evidence');
    }
    for (const [field, value] of [
      ['Check digest', verification.checkDigest],
      ['protected-asset lease digest', verification.protectedAssetReadLeaseDigest],
      ['isolation profile digest', verification.isolationProfileDigest],
      ['environment digest', verification.environmentDigest],
    ]) {
      assertDigest(value, `M2 traced verification ${field}`);
    }
    assertString(verification.attemptId, 'M2 verification Attempt ID');
    assertString(verification.verificationObligationId, 'M2 Verification Obligation ID');
  }

  const dispatches = assertArray(trace.dispatches, 'M2 acceptance trace dispatches');
  const expectedDispatchCount = expected.generationCount;
  if (dispatches.length !== expectedDispatchCount) {
    throw new TypeError(
      'M2 acceptance trace dispatch count differs from the bounded generation count',
    );
  }
  for (const rawDispatch of dispatches) {
    const dispatch = assertObject(rawDispatch, 'M2 acceptance trace dispatch');
    assertString(dispatch.attemptId, 'M2 dispatch Attempt ID');
    assertString(dispatch.workerSessionId, 'M2 dispatch Worker Session ID');
    assertString(dispatch.contextManifestId, 'M2 dispatch Context Manifest ID');
    assertDigest(dispatch.contextManifestDigest, 'M2 dispatch Context Manifest digest');
    assertDigest(dispatch.contextPackageDigest, 'M2 dispatch Context Package digest');
    if (dispatch.planId !== plan.id || dispatch.planDigest !== plan.digest) {
      throw new TypeError('M2 protected dispatch does not bind the immutable Plan');
    }
  }

  const repairExpected = expected.evidence[0] === 'FAIL';
  const repairDispatch = dispatches.at(-1);
  if (repairExpected) {
    if (
      trace.repair === undefined ||
      repairDispatch?.repair === undefined ||
      repairDispatch.priorAttemptFeedback === undefined
    ) {
      throw new TypeError('M2 repair trace lacks exact repair Context or feedback authority');
    }
    assertDigest(repairDispatch.repairContextDigest, 'M2 repair Context digest');
    assertDigest(repairDispatch.priorAttemptFeedbackDigest, 'M2 prior-attempt feedback digest');
    if (
      repairDispatch.repair.repairCandidateGenerationId !==
        trace.repair.repairCandidateGenerationId ||
      repairDispatch.repair.acceptanceRepairDigest !== trace.repair.repairDigest
    ) {
      throw new TypeError('M2 repair dispatch differs from the retained repair record');
    }
    const repairKinds = new Set(
      assertArray(repairDispatch.contextSources, 'M2 repair Context sources').map(
        (entry) => assertObject(entry, 'M2 repair Context source').kind,
      ),
    );
    for (const requiredKind of [
      'ACCEPTANCE_REPAIR',
      'ACCEPTANCE_DECISION',
      'ACCEPTANCE_INPUT_MANIFEST',
      'EVIDENCE_SET',
      'EVIDENCE',
      'EVIDENCE_ELIGIBILITY',
      'CANDIDATE_RELATIONSHIP',
      'PRESERVATION_CONSTRAINT',
      'PRIOR_ATTEMPT_FEEDBACK',
    ]) {
      if (!repairKinds.has(requiredKind)) {
        throw new TypeError(`M2 repair Context lacks source kind ${requiredKind}`);
      }
    }
    for (const forbiddenKind of ['WORKING_CONTEXT', 'PROJECT_OBSERVATION']) {
      if (repairKinds.has(forbiddenKind)) {
        throw new TypeError(`M2 repair Context silently injected ${forbiddenKind}`);
      }
    }
  } else if (trace.repair !== undefined) {
    throw new TypeError('M2 non-repair branch retained unexpected repair authority');
  }

  const externalExecutions = assertArray(trace.externalExecutions, 'M2 traced external executions');
  const expectedExternalExecutionCount = expected.externalExecutionCount ?? 0;
  if (externalExecutions.length !== expectedExternalExecutionCount) {
    throw new TypeError('M2 acceptance trace external execution count differs from the branch');
  }
  for (const rawExecution of externalExecutions) {
    const execution = assertObject(rawExecution, 'M2 traced external execution');
    for (const [field, value] of [
      ['binary identity', execution.binaryIdentityDigest],
      ['protocol schema', execution.protocolSchemaDigest],
      ['execution config', execution.executionConfigDigest],
      ['managed requirements', execution.managedRequirementsDigest],
      ['instruction-source manifest', execution.instructionSourceManifestDigest],
      ['intent', execution.intentDigest],
      ['record', execution.recordDigest],
    ]) {
      assertDigest(value, `M2 external execution ${field} digest`);
    }
    if (expected.branch === 'ADAPTER_FAILURE') {
      if (execution.state !== 'FAILED') {
        throw new TypeError('M2 adapter-failure execution did not retain FAILED state');
      }
    } else if (
      execution.state !== 'COMPLETED' ||
      typeof execution.backendSessionRef !== 'string' ||
      typeof execution.backendOperationRef !== 'string'
    ) {
      throw new TypeError('M2 live execution lacks completed Session/Turn observations');
    }
  }

  if (expected.technicalCloseout) {
    const acceptance = assertObject(trace.acceptance, 'M2 traced Acceptance');
    if (acceptance.outcome !== 'ACCEPT' || acceptance.closeout === undefined) {
      throw new TypeError('M2 accepted branch lacks exact Acceptance and Closeout trace');
    }
  } else if (expected.branch === 'REPAIR_FAILED_STOP') {
    const acceptance = assertObject(trace.acceptance, 'M2 failed-repair Acceptance');
    if (acceptance.outcome !== 'REJECT_REPAIRABLE' || acceptance.closeout !== undefined) {
      throw new TypeError('M2 failed repair does not retain the visible repair-required stop');
    }
  } else if (trace.acceptance !== undefined) {
    throw new TypeError('M2 adapter failure unexpectedly retained Acceptance authority');
  }
  return trace;
}

function expectedDemo(scenario, branch) {
  const table = {
    'm2-protected-repair': {
      proofCode: 'M2_PROTECTED_REPAIR_ACCEPTED',
      branch: 'REPAIR_ACCEPTED',
      generationCount: 2,
      evidence: ['FAIL', 'PASS'],
      runStatus: 'CLOSED',
      technicalCloseout: true,
      driveStop: 'CLOSED',
      workerWritableTestPassed: true,
    },
    'm2-protected-failed-repair': {
      proofCode: 'M2_PROTECTED_FAILED_REPAIR_STOPPED',
      branch: 'REPAIR_FAILED_STOP',
      generationCount: 2,
      evidence: ['FAIL', 'FAIL'],
      runStatus: 'READY',
      technicalCloseout: false,
      driveStop: 'ACCEPTANCE_REPAIR_REQUIRED',
      workerWritableTestPassed: true,
    },
    'm2-adapter-failure': {
      proofCode: 'M2_ADAPTER_FAILURE_GOVERNED',
      branch: 'ADAPTER_FAILURE',
      generationCount: 1,
      evidence: [],
      runStatus: 'FAILED',
      technicalCloseout: false,
      driveStop: 'FAILED',
      externalExecutionCount: 1,
      externalFailureCode: 'EFFECTIVE_INPUT_MISMATCH',
    },
    'm2-live-repair-handoff': {
      proofCode: 'M2_LIVE_REPAIR_HANDOFF_CLOSED',
      branch: 'LIVE_REPAIR_HANDOFF_ACCEPTED',
      generationCount: 2,
      evidence: ['FAIL', 'PASS'],
      runStatus: 'CLOSED',
      technicalCloseout: true,
      driveStop: 'CLOSED',
      externalExecutionCount: 1,
    },
    'm2-live:first-pass': {
      proofCode: 'M2_LIVE_NATURAL_BRANCH_CLOSED',
      branch: 'LIVE_FIRST_PASS_ACCEPTED',
      generationCount: 1,
      evidence: ['PASS'],
      runStatus: 'CLOSED',
      technicalCloseout: true,
      driveStop: 'CLOSED',
      externalExecutionCount: 1,
    },
    'm2-live:repair': {
      proofCode: 'M2_LIVE_NATURAL_BRANCH_CLOSED',
      branch: 'LIVE_REPAIR_ACCEPTED',
      generationCount: 2,
      evidence: ['FAIL', 'PASS'],
      runStatus: 'CLOSED',
      technicalCloseout: true,
      driveStop: 'CLOSED',
      externalExecutionCount: 2,
    },
  };
  const key = scenario === 'm2-live' ? `${scenario}:${branch}` : scenario;
  const aliases = {
    'm2-live:LIVE_FIRST_PASS_ACCEPTED': 'm2-live:first-pass',
    'm2-live:LIVE_REPAIR_ACCEPTED': 'm2-live:repair',
  };
  return table[aliases[key] ?? key];
}

export function validateM2DemoEnvelope(envelope, scenario) {
  const root = assertObject(envelope, `${scenario} envelope`);
  if (root.schemaVersion !== 1 || root.kind !== 'DEMO_RESULT' || root.operation !== 'demo run') {
    throw new TypeError(`${scenario} did not return the public demo envelope`);
  }
  const result = assertObject(root.result, `${scenario} result`);
  if (result.scenario !== scenario) {
    throw new TypeError(`${scenario} result names another scenario`);
  }
  if (result.passed !== true) {
    if (result.passed !== false || (result.outcome !== 'BLOCKED' && result.outcome !== 'FAILED')) {
      throw new TypeError(`${scenario} returned an invalid non-passing result`);
    }
    return Object.freeze({
      outcome:
        result.outcome === 'BLOCKED' ? M2AcceptanceOutcome.BLOCKED : M2AcceptanceOutcome.FAIL,
      reasonCode: assertString(
        result.outcome === 'BLOCKED' ? result.blockerCode : result.failureCode,
        `${scenario} reason code`,
      ),
    });
  }
  const m2 = assertObject(result.m2, `${scenario} M2 detail`);
  const expected = expectedDemo(scenario, m2.branch);
  if (expected === undefined) {
    throw new TypeError(`${scenario} returned an unsupported branch: ${String(m2.branch)}`);
  }
  for (const [field, actual] of [
    ['proofCode', result.proofCode],
    ['branch', m2.branch],
    ['generationCount', m2.generationCount],
  ]) {
    if (actual !== expected[field]) {
      throw new TypeError(`${scenario} ${field} differs from the acceptance contract`);
    }
  }
  const finalStatus = assertObject(result.finalStatus, `${scenario} final status`);
  const reopenedStatus = assertObject(result.reopenedStatus, `${scenario} reopened status`);
  if (!exactJsonEqual(finalStatus, reopenedStatus)) {
    throw new TypeError(`${scenario} public status changed across strict reopen`);
  }
  if (
    finalStatus.runStatus !== expected.runStatus ||
    finalStatus.technicalCloseout !== expected.technicalCloseout
  ) {
    throw new TypeError(`${scenario} final Workflow status differs from the selected branch`);
  }
  if (expected.technicalCloseout) {
    if (
      finalStatus.phase !== 'CLOSEOUT' ||
      assertObject(finalStatus.acceptanceSummary, `${scenario} Acceptance summary`).outcome !==
        'ACCEPT'
    ) {
      throw new TypeError(`${scenario} did not close through technical Acceptance`);
    }
  } else if (finalStatus.closeoutRef !== undefined) {
    throw new TypeError(`${scenario} retained closeout authority on a non-closeout branch`);
  }
  const finalDrive = assertObject(result.finalDrive, `${scenario} final drive`);
  if (finalDrive.stopReason !== expected.driveStop) {
    throw new TypeError(`${scenario} final drive stop differs from the selected branch`);
  }
  if (m2.sourceUnchanged !== true) {
    throw new TypeError(`${scenario} did not prove source isolation`);
  }
  const sourceIdentity = assertObject(m2.sourceIdentity, `${scenario} source identity`);
  const evidence = validateEvidence(m2, expected.evidence);
  const acceptanceTrace = validateAcceptanceTrace(m2, expected, evidence);
  const audit = validateAudit(result);
  assertString(m2.planId, `${scenario} protected Plan ID`);
  assertDigest(m2.planDigest, `${scenario} protected Plan digest`);
  assertDigest(sourceIdentity.sourceTreeDigest, `${scenario} source tree digest`);
  assertDigest(sourceIdentity.sourceGitMetadataDigest, `${scenario} Git metadata digest`);
  if (
    expected.workerWritableTestPassed !== undefined &&
    m2.workerWritableTestPassed !== expected.workerWritableTestPassed
  ) {
    throw new TypeError(`${scenario} did not prove the Worker-writable test result`);
  }
  if (
    expected.externalExecutionCount !== undefined &&
    m2.externalExecutionCount !== expected.externalExecutionCount
  ) {
    throw new TypeError(`${scenario} external execution count differs from the bounded branch`);
  }
  if (
    expected.externalFailureCode !== undefined &&
    m2.externalFailureCode !== expected.externalFailureCode
  ) {
    throw new TypeError(`${scenario} external failure classification differs from the contract`);
  }
  return Object.freeze({
    outcome: M2AcceptanceOutcome.PASS,
    proof: Object.freeze({
      scenario,
      proofCode: result.proofCode,
      branch: m2.branch,
      goalId: assertString(result.goalId, `${scenario} Goal ID`),
      generationCount: m2.generationCount,
      externalExecutionCount: m2.externalExecutionCount ?? 0,
      planId: m2.planId,
      planDigest: m2.planDigest,
      evidence,
      acceptanceTrace,
      sourceIdentity: Object.freeze({
        sourceTreeDigest: sourceIdentity.sourceTreeDigest,
        sourceGitMetadataDigest: sourceIdentity.sourceGitMetadataDigest,
      }),
      audit,
      finalRunStatus: finalStatus.runStatus,
      technicalCloseout: finalStatus.technicalCloseout,
    }),
  });
}

export function validateLivePreflight(value) {
  const result = assertObject(value, 'Live compatibility preflight');
  if (
    result.schemaVersion !== 1 ||
    result.probe !== 'codeclosure-m2-slice1-live-client' ||
    assertObject(result.lifecycle, 'Live preflight lifecycle').initialized !== true ||
    result.lifecycle.threadStarted !== true ||
    result.lifecycle.turnStatus !== 'completed' ||
    assertObject(result.controlledInputs, 'Live preflight controlled inputs')
      .instructionSourcesExact !== true ||
    result.controlledInputs.poisonedProjectConfigExcluded !== true ||
    result.controlledStateRemovedAfterProbe !== true
  ) {
    throw new TypeError('Live compatibility preflight did not prove its bounded lifecycle');
  }
  const binary = assertObject(result.binary, 'Live preflight binary');
  assertDigest(binary.snapshotDigest, 'Live preflight protocol snapshot digest');
  const controlledInputs = result.controlledInputs;
  assertDigest(controlledInputs.configDigest, 'Live preflight config digest');
  assertDigest(controlledInputs.requirementsDigest, 'Live preflight requirements digest');
  const diagnostics = assertObject(result.diagnostics, 'Live preflight diagnostics');
  assertDigest(diagnostics.stderrDigest, 'Live preflight stderr digest');
  if (diagnostics.stderrPersisted !== false) {
    throw new TypeError('Live preflight persisted stderr diagnostics');
  }
  return Object.freeze({
    version: assertString(binary.version, 'Live preflight Codex version'),
    snapshotDigest: binary.snapshotDigest,
    configDigest: controlledInputs.configDigest,
    requirementsDigest: controlledInputs.requirementsDigest,
    permissionProfile: controlledInputs.permissionProfile,
    stderrDigest: diagnostics.stderrDigest,
    stderrCapturedBytes: diagnostics.stderrCapturedBytes,
  });
}

function requirePattern(value, pattern, message) {
  if (!pattern.test(value)) {
    throw new TypeError(message);
  }
}

export function validateM2ScopeReview(documents, productSources) {
  const requiredDocuments = [
    'agents',
    'readme',
    'm2CompletionReview',
    'architecture',
    'domainModel',
    'workflow',
    'contextCompiler',
    'acceptanceEngine',
    'evidenceModel',
    'adrIndex',
    'milestones',
    'implementationPlan',
    'acceptancePlan',
  ];
  for (const name of requiredDocuments) {
    assertString(documents[name], `M2 scope document ${name}`);
  }
  requirePattern(
    documents.agents,
    /M2\.5 — Goal Intake and Materialization — is the current milestone boundary/u,
    'AGENTS does not record M2.5 as the current milestone boundary',
  );
  requirePattern(
    documents.agents,
    /independent M2 exit review was a\s+prerequisite for M2\.5 implementation and passed on 2026-08-02/u,
    'AGENTS does not preserve the satisfied independent M2 prerequisite',
  );
  requirePattern(
    documents.m2CompletionReview,
    /M2\.5 remains not started;[\s\S]{0,200}no Raw Request[\s\S]{0,200}entered product source/u,
    'M2 completion review does not retain the historical M2.5 non-claim',
  );
  requirePattern(
    documents.architecture,
    /Goal Intake is not an M2 exit condition/u,
    'Architecture does not preserve the Goal Intake boundary',
  );
  requirePattern(
    documents.workflow,
    /Goal Intake is[\s\S]{0,120}accepted pre-Goal target for M2\.5[\s\S]{0,180}no[\s\S]{0,80}(Intake transition|Workflow mutation)[\s\S]{0,100}operational/u,
    'Workflow does not preserve the non-operational Goal Intake boundary',
  );
  requirePattern(
    documents.contextCompiler,
    /Goal-bound Worker Context Compiler;[\s\S]{0,180}separate Intake Package and Manifest[\s\S]{0,300}Slice 3 implements the separate deterministic Intake\/Answer package compiler[\s\S]{0,180}without changing Goal-bound Worker Context authority/u,
    'Context Compiler does not preserve the separate M2.5 Intake compiler boundary',
  );
  requirePattern(
    documents.acceptanceEngine,
    /Intent Admission[\s\S]{0,300}technical Acceptance Engine[\s\S]{0,100}(unchanged|no pre-Goal)/u,
    'Acceptance Engine does not disclaim Goal Intake authority',
  );
  requirePattern(
    documents.evidenceModel,
    /Intake observations[\s\S]{0,240}cannot satisfy a formal Goal's Acceptance/u,
    'Evidence Model does not preserve the Intake evidence boundary',
  );
  for (const identifier of ['0028', '0029', '0030', '0031', '0032', '0033']) {
    requirePattern(
      documents.adrIndex,
      new RegExp(`\\| \\[${identifier}\\]\\([^\\n]+\\) \\| [^\\n]+ \\| Accepted \\|`, 'u'),
      `ADR ${identifier} is not indexed as Accepted`,
    );
  }
  requirePattern(
    documents.milestones,
    /## M2 — Codex Vertical Slice[\s\S]*?M2\.5 implementation MUST NOT begin/u,
    'Milestone record does not preserve the independent M2 gate',
  );
  requirePattern(
    documents.implementationPlan,
    /### Slice 8 — Milestone audit and acceptance harness[\s\S]*?M2\.5 implementation MUST NOT start/u,
    'Implementation plan does not retain the Slice 8 gate',
  );
  requirePattern(
    documents.acceptancePlan,
    /There is no conditional pass, waiver, expected failure, flaky pass, optional[\s\S]{0,100}mandatory row/u,
    'Acceptance plan no longer prohibits conditional M2 pass',
  );
  requirePattern(
    documents.domainModel,
    /Slice 7[\s\S]{0,600}(implemented|implements)/u,
    'Domain Model status does not identify Slice 7 as implemented',
  );
  if (
    /ADR 0031 plan plus schema-version-3[\s\S]{0,500}remain later M2 work/u.test(
      documents.domainModel,
    )
  ) {
    throw new TypeError('Domain Model still describes implemented Slice 7 authority as later work');
  }
  const intakeImplementationTokens = [
    'RawRequestId',
    'IntakeRunId',
    'IntentAnalysisProposalId',
    'IntentProjectionId',
    'IntentAdmissionDecisionId',
    'GoalMaterializationRecord',
  ];
  const implementedIntakeTokens = intakeImplementationTokens.filter((token) =>
    productSources.includes(token),
  );
  if (
    implementedIntakeTokens.length !== 0 &&
    implementedIntakeTokens.length !== intakeImplementationTokens.length
  ) {
    throw new TypeError(
      `M2.5 Slice 1 Intake contract is partial: ${implementedIntakeTokens.join(', ')}`,
    );
  }
  const operationalIntakeTokens = [
    'GoalIntakeCoordinator',
    'IntakeControlStore',
    'IntakeAssistantPort',
    'materializeGoal(',
    'submitIntake(',
  ].filter((token) => productSources.includes(token));
  if (operationalIntakeTokens.length !== 0) {
    throw new TypeError(
      `M2.5 operational Intake work exceeds the recorded Slice 1 boundary: ${operationalIntakeTokens.join(', ')}`,
    );
  }
  return Object.freeze({
    reviewedDocuments: requiredDocuments.length,
    acceptedM2Adrs: 6,
    goalIntakeSlice1ContractTokens: implementedIntakeTokens.length,
    goalIntakeOperationalTokens: operationalIntakeTokens.length,
    goalIntakeBoundary: 'NOT_M2_SCOPE',
    externalEffectAuthority: 'NOT_AUTHORIZED',
  });
}

function stagesForRow(identifier) {
  const stage = M2AcceptanceStage;
  const group = identifier.slice(3, 4);
  if (identifier === 'M2-A01') return [stage.SOURCE_OPENING, stage.SOURCE_CLOSING];
  if (identifier === 'M2-A02') return [stage.ENTRY, stage.QUALITY];
  if (identifier === 'M2-A03') return [stage.QUALITY, stage.SCOPE_REVIEW];
  if (identifier === 'M2-A07' || identifier === 'M2-A08') {
    return [stage.PROTOCOL, stage.QUALITY];
  }
  if (identifier === 'M2-B09') return [stage.LIVE_PREFLIGHT];
  if (identifier === 'M2-B10') {
    return [stage.QUALITY, stage.LIVE_PREFLIGHT, stage.LIVE_REPAIR_HANDOFF, stage.LIVE_NATURAL];
  }
  if (identifier === 'M2-B11') return [stage.QUALITY, stage.LIVE_PREFLIGHT];
  if (group === 'C') {
    if (identifier === 'M2-C04') return [stage.QUALITY, stage.PROTECTED_REPAIR];
    if (identifier === 'M2-C07') return [stage.QUALITY, stage.ADAPTER_FAILURE];
    if (identifier === 'M2-C10') {
      return [stage.QUALITY, stage.LIVE_PREFLIGHT, stage.LIVE_NATURAL];
    }
    if (identifier === 'M2-C11') return [stage.QUALITY, stage.LIVE_NATURAL];
  }
  if (group === 'D') {
    if (identifier === 'M2-D09') {
      return [stage.PROTECTED_REPAIR, stage.LIVE_REPAIR_HANDOFF, stage.LIVE_NATURAL];
    }
    if (identifier === 'M2-D10') return [stage.QUALITY, stage.LIVE_NATURAL];
    return [stage.QUALITY, stage.PROTECTED_REPAIR];
  }
  if (group === 'E') {
    if (identifier === 'M2-E09' || identifier === 'M2-E13') {
      return [stage.QUALITY, stage.PROTECTED_REPAIR, stage.LIVE_NATURAL];
    }
    return [stage.QUALITY, stage.PROTECTED_REPAIR];
  }
  if (group === 'F') {
    const mapping = {
      'M2-F01': [stage.PROTECTED_REPAIR],
      'M2-F02': [stage.PROTECTED_REPAIR],
      'M2-F03': [stage.PROTECTED_REPAIR],
      'M2-F04': [stage.LIVE_NATURAL],
      'M2-F05': [stage.LIVE_NATURAL],
      'M2-F06': [stage.LIVE_NATURAL],
      'M2-F07': [stage.LIVE_NATURAL],
      'M2-F08': [stage.SCOPE_REVIEW, stage.LIVE_REPAIR_HANDOFF, stage.LIVE_NATURAL],
      'M2-F09': [stage.PROTECTED_REPAIR],
      'M2-F10': [stage.PROTECTED_REPAIR, stage.LIVE_REPAIR_HANDOFF],
      'M2-F11': [stage.FAILED_REPAIR],
    };
    return mapping[identifier];
  }
  if (group === 'G') {
    if (identifier === 'M2-G05') return [stage.QUALITY, stage.ADAPTER_FAILURE];
    if (identifier === 'M2-G09') {
      return [stage.QUALITY, stage.SCOPE_REVIEW, stage.LIVE_REPAIR_HANDOFF, stage.LIVE_NATURAL];
    }
    if (['M2-G12', 'M2-G13', 'M2-G14', 'M2-G15'].includes(identifier)) {
      return [stage.QUALITY, stage.LIVE_REPAIR_HANDOFF];
    }
    if (identifier === 'M2-G16' || identifier === 'M2-G17') {
      return [stage.QUALITY, stage.FAILED_REPAIR];
    }
  }
  if (group === 'H') {
    const mapping = {
      'M2-H01': [stage.QUALITY],
      'M2-H02': [stage.QUALITY, stage.M1_BLACK_BOX],
      'M2-H03': [stage.QUALITY, stage.M1_BLACK_BOX],
      'M2-H04': [stage.QUALITY, stage.LIVE_NATURAL],
      'M2-H05': [stage.QUALITY, stage.SCOPE_REVIEW],
      'M2-H06': [stage.QUALITY, stage.SCOPE_REVIEW],
      'M2-H07': [stage.M1_BLACK_BOX, stage.SCOPE_REVIEW],
      'M2-H08': [stage.PROTECTED_REPAIR, stage.SCOPE_REVIEW],
    };
    return mapping[identifier];
  }
  return [stage.QUALITY];
}

function outcomeForStages(stageIds, stagesById) {
  const outcomes = stageIds.map((identifier) => stagesById.get(identifier)?.outcome);
  if (outcomes.includes(M2AcceptanceOutcome.FAIL)) return M2AcceptanceOutcome.FAIL;
  if (
    outcomes.includes(M2AcceptanceOutcome.BLOCKED) ||
    outcomes.some((outcome) => outcome === undefined)
  ) {
    return M2AcceptanceOutcome.BLOCKED;
  }
  return M2AcceptanceOutcome.PASS;
}

export function buildMatrixResults(matrixRows, stages) {
  const stagesById = new Map(stages.map((stage) => [stage.id, stage]));
  return Object.freeze(
    matrixRows.map((row) => {
      const evidenceStages = stagesForRow(row.id);
      if (evidenceStages === undefined || evidenceStages.length === 0) {
        throw new TypeError(`M2 matrix row ${row.id} has no executable evidence mapping`);
      }
      return Object.freeze({
        ...row,
        outcome: outcomeForStages(evidenceStages, stagesById),
        evidenceStages: Object.freeze(evidenceStages),
      });
    }),
  );
}

export function acceptanceVerdict(matrixResults) {
  const outcomes = matrixResults.map(({ outcome }) => outcome);
  if (outcomes.includes(M2AcceptanceOutcome.FAIL)) return M2AcceptanceOutcome.FAIL;
  if (outcomes.includes(M2AcceptanceOutcome.BLOCKED)) return M2AcceptanceOutcome.BLOCKED;
  return M2AcceptanceOutcome.PASS;
}
