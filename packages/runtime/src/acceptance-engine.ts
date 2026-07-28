import {
  CandidateGenerationState,
  RuleOutcome,
  WorkflowPhase,
  acceptanceDecisionProjection,
  aggregateAcceptanceOutcome,
  decodeAcceptanceDecision,
  dominantAcceptanceReasonCode,
  type AcceptanceDecision,
  type AcceptanceDecisionId,
  type IsoTimestamp,
  type RuleResult,
} from '@codeclosure/domain';

import {
  M1AcceptanceRuleId,
  M1_ACCEPTANCE_ENGINE_VERSION,
  M1_ACCEPTANCE_RULES,
  currentBlockingIssues,
  evidenceRuleOutcome,
  m1RuleResult,
  pendingIssueRuleOutcome,
  validateM1AcceptancePolicyBundle,
  type CompiledM1AcceptanceInput,
  type createM1AcceptanceCheckerIdentity,
} from './acceptance-policy.js';
import { canonicalizeJson } from './canonical-json.js';
import type { DigestProvider } from './ports.js';

export interface IssueM1AcceptanceDecision {
  readonly id: AcceptanceDecisionId;
  readonly issuedAt: IsoTimestamp;
  readonly input: CompiledM1AcceptanceInput;
}

export interface M1AcceptanceEngine {
  issueDecision(request: IssueM1AcceptanceDecision): AcceptanceDecision;
}

function reasonForOutcome(
  outcome: RuleOutcome,
  passed: string,
  repairable: string,
  blocked: string,
  engineError: string,
  needsDecision = blocked,
): string {
  switch (outcome) {
    case RuleOutcome.PASS:
      return passed;
    case RuleOutcome.FAIL_REPAIRABLE:
      return repairable;
    case RuleOutcome.FAIL_BLOCKED:
      return blocked;
    case RuleOutcome.ENGINE_ERROR:
      return engineError;
    case RuleOutcome.NEEDS_DECISION:
      return needsDecision;
    case RuleOutcome.NOT_APPLICABLE_WITH_REASON:
      return blocked;
  }
}

class DeterministicM1AcceptanceEngine implements M1AcceptanceEngine {
  readonly #digests: DigestProvider;

  public constructor(digests: DigestProvider) {
    this.#digests = digests;
  }

  public issueDecision(request: IssueM1AcceptanceDecision): AcceptanceDecision {
    const { input } = request;
    const checker = validateM1AcceptancePolicyBundle(input.authority.policyBundle, this.#digests);
    let results: readonly RuleResult[];
    try {
      results = this.evaluateRules(input, checker.checkerDigest);
    } catch {
      results = Object.freeze(
        M1_ACCEPTANCE_RULES.map((ruleId) =>
          m1RuleResult(
            ruleId,
            RuleOutcome.ENGINE_ERROR,
            'ACCEPTANCE_RULE_EVALUATION_ERROR',
            'The built-in Acceptance rule could not be evaluated',
            [input.manifest.manifestDigest],
            [],
            checker.checkerDigest,
          ),
        ),
      );
    }
    if (!results.every((result, index) => result.ruleId === M1_ACCEPTANCE_RULES[index])) {
      throw new TypeError('Acceptance Engine emitted Rule Results outside Policy order');
    }
    const decisionBase = Object.freeze({
      id: request.id,
      schemaVersion: 1 as const,
      inputManifestDigest: input.manifest.manifestDigest,
      policyBundleDigest: input.authority.policyBundle.digest,
      outcome: aggregateAcceptanceOutcome(results),
      dominantReasonCode: dominantAcceptanceReasonCode(results),
      ruleResults: results,
      engineVersion: M1_ACCEPTANCE_ENGINE_VERSION,
      issuedAt: request.issuedAt,
    });
    return decodeAcceptanceDecision({
      ...decisionBase,
      decisionDigest: this.#digests.digest(acceptanceDecisionProjection(decisionBase)),
    });
  }

  private evaluateRules(
    input: CompiledM1AcceptanceInput,
    checkerDigest: ReturnType<typeof createM1AcceptanceCheckerIdentity>['checkerDigest'],
  ): readonly RuleResult[] {
    const { authority, manifest } = input;
    const workflowPasses =
      authority.workflow.phase === WorkflowPhase.FINAL_VERIFY &&
      authority.workflow.version === manifest.workflowVersion &&
      authority.workflow.id === manifest.workflowId;
    const goalPasses =
      authority.goal.id === manifest.goalId &&
      authority.goal.revision === manifest.goalRevision &&
      authority.workflow.goalRevision === manifest.goalRevision;
    const candidatePasses =
      authority.workflow.activeCandidateGenerationId === authority.generation.id &&
      authority.generation.id === manifest.candidateGenerationId &&
      authority.generation.state === CandidateGenerationState.FROZEN;
    const candidateDigestPasses =
      authority.generation.frozenDigest === manifest.candidateDigest &&
      authority.evidenceSet.candidateDigest === manifest.candidateDigest;
    const requiredCriteria = authority.goal.successCriteria.filter(
      (criterion) => criterion.required,
    );
    const mappedCriteria = authority.obligations.flatMap((obligation) =>
      obligation.sourceCriterionRefs.length === 1 ? obligation.sourceCriterionRefs : [],
    );
    const obligationsPass =
      requiredCriteria.length > 0 &&
      authority.obligations.length === requiredCriteria.length &&
      requiredCriteria.every((criterion, index) => mappedCriteria[index] === criterion.id);
    const evidenceOutcome = evidenceRuleOutcome(input);
    const blockingIssues = currentBlockingIssues(input);
    const issueOutcome = pendingIssueRuleOutcome(blockingIssues);
    const policyChecker = validateM1AcceptancePolicyBundle(authority.policyBundle, this.#digests);
    const policyPasses =
      manifest.policyBundleId === authority.policyBundle.id &&
      manifest.policyBundleDigest === authority.policyBundle.digest &&
      policyChecker.checkerDigest === checkerDigest;

    return Object.freeze([
      m1RuleResult(
        M1AcceptanceRuleId.WORKFLOW_FINAL_VERIFY,
        workflowPasses ? RuleOutcome.PASS : RuleOutcome.FAIL_BLOCKED,
        workflowPasses ? 'WORKFLOW_FINAL_VERIFY_CURRENT' : 'WORKFLOW_FINAL_VERIFY_STALE',
        workflowPasses
          ? 'Workflow is current in FINAL_VERIFY'
          : 'Workflow is not current in FINAL_VERIFY',
        [manifest.workflowId, String(manifest.workflowVersion)],
        [],
        checkerDigest,
      ),
      m1RuleResult(
        M1AcceptanceRuleId.GOAL_REVISION_CURRENT,
        goalPasses ? RuleOutcome.PASS : RuleOutcome.FAIL_BLOCKED,
        goalPasses ? 'GOAL_REVISION_CURRENT' : 'GOAL_REVISION_STALE',
        goalPasses ? 'Goal revision is current' : 'Goal revision does not match the Workflow',
        [manifest.goalId, String(manifest.goalRevision)],
        [],
        checkerDigest,
      ),
      m1RuleResult(
        M1AcceptanceRuleId.CANDIDATE_CURRENT_FROZEN,
        candidatePasses ? RuleOutcome.PASS : RuleOutcome.FAIL_BLOCKED,
        candidatePasses ? 'CANDIDATE_CURRENT_FROZEN' : 'CANDIDATE_NOT_CURRENT_FROZEN',
        candidatePasses
          ? 'Current Candidate generation is frozen'
          : 'Candidate generation is not the current frozen generation',
        [manifest.candidateGenerationId],
        [],
        checkerDigest,
      ),
      m1RuleResult(
        M1AcceptanceRuleId.CANDIDATE_DIGEST_CURRENT,
        candidateDigestPasses ? RuleOutcome.PASS : RuleOutcome.FAIL_BLOCKED,
        candidateDigestPasses ? 'CANDIDATE_DIGEST_CURRENT' : 'CANDIDATE_DIGEST_STALE',
        candidateDigestPasses
          ? 'Candidate digest matches frozen and Evidence Set authority'
          : 'Candidate digest does not match current authority',
        [manifest.candidateDigest, manifest.evidenceSetDigest],
        [],
        checkerDigest,
      ),
      m1RuleResult(
        M1AcceptanceRuleId.REQUIRED_OBLIGATIONS_PRESENT,
        obligationsPass ? RuleOutcome.PASS : RuleOutcome.FAIL_BLOCKED,
        obligationsPass ? 'REQUIRED_OBLIGATIONS_PRESENT' : 'REQUIRED_OBLIGATIONS_INCOMPLETE',
        obligationsPass
          ? 'Every required criterion has one current obligation'
          : 'Required criterion obligations are missing or mismatched',
        authority.obligations.map((obligation) => obligation.id),
        [],
        checkerDigest,
      ),
      m1RuleResult(
        M1AcceptanceRuleId.REQUIRED_EVIDENCE_PASSING,
        evidenceOutcome,
        reasonForOutcome(
          evidenceOutcome,
          'REQUIRED_EVIDENCE_PASSING',
          'REQUIRED_EVIDENCE_FAILED_REPAIRABLE',
          'REQUIRED_EVIDENCE_MISSING_OR_STALE',
          'REQUIRED_EVIDENCE_ENGINE_ERROR',
        ),
        evidenceOutcome === RuleOutcome.PASS
          ? 'Every required obligation has current passing Evidence'
          : 'Required Evidence does not establish acceptance',
        [manifest.evidenceSetDigest],
        authority.evidenceSet.evidenceRefs.map((reference) => reference.evidenceId),
        checkerDigest,
      ),
      m1RuleResult(
        M1AcceptanceRuleId.PENDING_ISSUES_CLEAR,
        issueOutcome,
        reasonForOutcome(
          issueOutcome,
          'NO_BLOCKING_PENDING_ISSUES',
          'REPAIRABLE_PENDING_ISSUE',
          'BLOCKING_PENDING_ISSUE',
          'PENDING_ISSUE_ENGINE_ERROR',
          'PENDING_ISSUE_NEEDS_DECISION',
        ),
        issueOutcome === RuleOutcome.PASS
          ? 'No current blocking Pending Issue remains'
          : 'A current blocking Pending Issue remains',
        [manifest.pendingIssueSetDigest],
        blockingIssues.map((issue) => issue.id),
        checkerDigest,
      ),
      m1RuleResult(
        M1AcceptanceRuleId.MANIFEST_POLICY_CURRENT,
        policyPasses ? RuleOutcome.PASS : RuleOutcome.FAIL_BLOCKED,
        policyPasses ? 'MANIFEST_POLICY_CURRENT' : 'MANIFEST_POLICY_STALE',
        policyPasses
          ? 'Manifest, Policy, and checker identities agree'
          : 'Manifest, Policy, or checker identity is stale',
        [manifest.manifestDigest, manifest.policyBundleDigest],
        [],
        checkerDigest,
      ),
    ]);
  }
}

export function createM1AcceptanceEngine(digests: DigestProvider): M1AcceptanceEngine {
  return new DeterministicM1AcceptanceEngine(digests);
}

export function verifyM1AcceptanceDecision(
  input: CompiledM1AcceptanceInput,
  rawDecision: AcceptanceDecision,
  digests: DigestProvider,
): AcceptanceDecision {
  const decision = decodeAcceptanceDecision(rawDecision);
  const expected = createM1AcceptanceEngine(digests).issueDecision({
    id: decision.id,
    issuedAt: decision.issuedAt,
    input,
  });
  if (canonicalizeJson(expected) !== canonicalizeJson(decision)) {
    throw new TypeError('Acceptance Decision does not match the built-in M1 engine result');
  }
  return decision;
}
