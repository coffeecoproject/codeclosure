import {
  ProtectedAssetReadLeaseAccessMode,
  ProtectedAssetReadLeaseLifecyclePolicy,
  acceptanceCriticalVerificationPlanProjection,
  assertAcceptanceCriticalSemanticCheckTemplateInvariant,
  assertAcceptanceCriticalVerificationPlanInvariant,
  assertProtectedVerificationAssetInvariant,
  decodeAcceptanceCriticalVerificationPlan,
  decodeProtectedAssetReadLease,
  protectedAssetManifestProjection,
  protectedAssetReadLeaseProjection,
  sha256Digest,
  type AcceptanceCriticalSemanticCheckTemplate,
  type AcceptanceCriticalVerificationPlan,
  type AcceptanceCriticalVerificationPlanId,
  type AcceptanceCriticalVerificationPlanProposal,
  type CandidateGeneration,
  type CheckSpecificationId,
  type ExecutionProfile,
  type Goal,
  type IsoTimestamp,
  type PolicyBundle,
  type ProtectedAssetReadLease,
  type ProtectedLocalCommandCheckSpecification,
  type ProtectedVerificationAsset,
  type WorkflowInstance,
} from '@codeclosure/domain';

import { canonicalizeJson } from './canonical-json.js';
import { localCommandEnvironmentDigest } from './local-command-verification-contracts.js';
import type { DigestProvider } from './ports.js';

export {
  decodeProtectedAssetReadLease,
  protectedAssetManifestProjection,
  protectedAssetReadLeaseProjection,
} from '@codeclosure/domain';
export type { ProtectedAssetReadLease, ProtectedVerificationAsset } from '@codeclosure/domain';

export interface ProtectedVerificationIdentityGenerator {
  nextAcceptanceCriticalVerificationPlanId(): AcceptanceCriticalVerificationPlanId;
}

export interface ProtectedAssetReadLeaseAuthorityPort {
  assertLeaseCurrent(lease: ProtectedAssetReadLease): ProtectedAssetReadLease;
}

export interface ProtectedVerificationRuntimeDependencies {
  readonly identities: ProtectedVerificationIdentityGenerator;
  readonly proposal: AcceptanceCriticalVerificationPlanProposal;
  readonly assets: ProtectedAssetReadLeaseAuthorityPort;
}

export function freezeAcceptanceCriticalVerificationPlanProposal(
  proposal: AcceptanceCriticalVerificationPlanProposal,
): AcceptanceCriticalVerificationPlanProposal {
  const criterionIds = canonicalSet(proposal.acceptanceCriticalCriterionIds);
  const ruleIds = canonicalSet(proposal.acceptanceRuleIds);
  if (
    new Set(criterionIds).size !== criterionIds.length ||
    new Set(ruleIds).size !== ruleIds.length
  ) {
    throw new TypeError('Protected Verification Plan proposal sets contain duplicates');
  }
  return Object.freeze({
    acceptanceCriticalCriterionIds: criterionIds,
    acceptanceRuleIds: ruleIds,
    semanticCheckTemplate: freezeTemplate(proposal.semanticCheckTemplate),
    protectedAssets: Object.freeze(proposal.protectedAssets.map((asset) => freezeAsset(asset))),
    protectedAssetManifestDigest: sha256Digest(proposal.protectedAssetManifestDigest),
    protectedAssetReadLeasePolicy: proposal.protectedAssetReadLeasePolicy,
    derivationRule: proposal.derivationRule,
    authoritySource: proposal.authoritySource,
  });
}

function exactValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canonicalSet<Value extends string>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...values].sort());
}

function freezeAsset(asset: ProtectedVerificationAsset): ProtectedVerificationAsset {
  const frozen = Object.freeze({ ...asset });
  assertProtectedVerificationAssetInvariant(frozen);
  return frozen;
}

function freezeTemplate(
  template: AcceptanceCriticalSemanticCheckTemplate,
): AcceptanceCriticalSemanticCheckTemplate {
  const frozen = Object.freeze({
    ...template,
    argv: Object.freeze([...template.argv]),
    environmentVariables: Object.freeze(
      template.environmentVariables.map((variable) => Object.freeze({ ...variable })),
    ),
    acceptedExitCodes: Object.freeze([...template.acceptedExitCodes]),
  });
  assertAcceptanceCriticalSemanticCheckTemplateInvariant(frozen);
  return frozen;
}

export function createAcceptanceCriticalVerificationPlan(
  input: Readonly<{
    id: AcceptanceCriticalVerificationPlanId;
    goal: Goal;
    resultingWorkflow: WorkflowInstance;
    policyBundle: PolicyBundle;
    executionProfile: ExecutionProfile;
    proposal: AcceptanceCriticalVerificationPlanProposal;
    createdAt: IsoTimestamp;
  }>,
  digests: DigestProvider,
): AcceptanceCriticalVerificationPlan {
  const criterionIds = canonicalSet(
    input.goal.successCriteria.filter((criterion) => criterion.required).map(({ id }) => id),
  );
  const proposal = freezeAcceptanceCriticalVerificationPlanProposal(input.proposal);
  const proposedCriterionIds = proposal.acceptanceCriticalCriterionIds;
  const ruleIds = canonicalSet(input.policyBundle.acceptanceRules);
  const proposedRuleIds = proposal.acceptanceRuleIds;
  if (
    input.resultingWorkflow.goalId !== input.goal.id ||
    input.resultingWorkflow.goalRevision !== input.goal.revision ||
    !exactValues(proposedCriterionIds, criterionIds) ||
    !exactValues(proposedRuleIds, ruleIds)
  ) {
    throw new TypeError(
      'Protected Verification Plan proposal does not cover the complete bounded authority set',
    );
  }
  const template = proposal.semanticCheckTemplate;
  const assets = proposal.protectedAssets;
  const manifestDigest = sha256Digest(digests.digest(protectedAssetManifestProjection(assets)));
  if (manifestDigest !== proposal.protectedAssetManifestDigest) {
    throw new TypeError('Protected asset manifest digest does not match its decoded asset set');
  }
  const fields = Object.freeze({
    schemaVersion: 1 as const,
    id: input.id,
    goalId: input.goal.id,
    goalRevision: input.goal.revision,
    workflowId: input.resultingWorkflow.id,
    workflowVersionAtLock: input.resultingWorkflow.version,
    policyBundleId: input.policyBundle.id,
    policyBundleDigest: input.policyBundle.digest,
    executionProfileId: input.executionProfile.id,
    executionProfileDigest: input.executionProfile.digest,
    acceptanceCriticalCriterionIds: proposedCriterionIds,
    acceptanceRuleIds: proposedRuleIds,
    semanticCheckTemplate: template,
    protectedAssets: assets,
    protectedAssetManifestDigest: manifestDigest,
    protectedAssetReadLeasePolicy: proposal.protectedAssetReadLeasePolicy,
    derivationRule: proposal.derivationRule,
    authoritySource: proposal.authoritySource,
    createdAt: input.createdAt,
  });
  const plan = decodeAcceptanceCriticalVerificationPlan({
    ...fields,
    planDigest: sha256Digest(digests.digest(acceptanceCriticalVerificationPlanProjection(fields))),
  });
  assertAcceptanceCriticalVerificationPlanInvariant(plan);
  return plan;
}

export function createProtectedAssetReadLease(
  input: Readonly<{
    plan: AcceptanceCriticalVerificationPlan;
    goal: Goal;
    workflow: WorkflowInstance;
    generation: CandidateGeneration;
    checkSpecificationId: CheckSpecificationId;
    checkSpecificationVersion: string;
  }>,
  digests: DigestProvider,
): ProtectedAssetReadLease {
  const expectedPlanDigest = sha256Digest(
    digests.digest(acceptanceCriticalVerificationPlanProjection(input.plan)),
  );
  const expectedManifestDigest = sha256Digest(
    digests.digest(protectedAssetManifestProjection(input.plan.protectedAssets)),
  );
  if (
    input.generation.frozenDigest === undefined ||
    input.workflow.goalId !== input.goal.id ||
    input.workflow.goalRevision !== input.goal.revision ||
    input.workflow.id !== input.plan.workflowId ||
    input.goal.id !== input.plan.goalId ||
    input.goal.revision !== input.plan.goalRevision ||
    expectedPlanDigest !== input.plan.planDigest ||
    expectedManifestDigest !== input.plan.protectedAssetManifestDigest
  ) {
    throw new TypeError('Protected asset lease cannot derive from stale authority');
  }
  const fields = Object.freeze({
    schemaVersion: 1 as const,
    goalId: input.goal.id,
    goalRevision: input.goal.revision,
    workflowId: input.workflow.id,
    candidateGenerationId: input.generation.id,
    candidateDigest: input.generation.frozenDigest,
    acceptanceCriticalVerificationPlanId: input.plan.id,
    acceptanceCriticalVerificationPlanDigest: input.plan.planDigest,
    protectedAssetManifestDigest: input.plan.protectedAssetManifestDigest,
    checkSpecificationId: input.checkSpecificationId,
    checkSpecificationVersion: input.checkSpecificationVersion,
    isolationProfileId: input.plan.semanticCheckTemplate.isolationProfileId,
    isolationProfileDigest: input.plan.semanticCheckTemplate.isolationProfileDigest,
    accessMode: ProtectedAssetReadLeaseAccessMode.READ_ONLY,
    lifecyclePolicy: ProtectedAssetReadLeaseLifecyclePolicy.SINGLE_VERIFICATION_INVOCATION,
    assets: input.plan.protectedAssets,
  });
  return decodeProtectedAssetReadLease({
    ...fields,
    leaseDigest: sha256Digest(digests.digest(protectedAssetReadLeaseProjection(fields))),
  });
}

export function assertProtectedLocalCommandCheckMatchesPlan(
  check: ProtectedLocalCommandCheckSpecification,
  plan: AcceptanceCriticalVerificationPlan,
  lease: ProtectedAssetReadLease,
  digests: DigestProvider,
): void {
  const template = plan.semanticCheckTemplate;
  const semanticProjection = Object.freeze({
    schemaVersion: 1 as const,
    checkVersion: check.version,
    producerIdentity: check.producerIdentity,
    operation: check.operation,
    runnerIdentity: check.runnerIdentity,
    runnerVersion: check.runnerVersion,
    executablePath: check.executablePath,
    executableDigest: check.executableDigest,
    declaredToolVersion: check.declaredToolVersion,
    argv: check.argv,
    cwd: check.cwd,
    environmentVariables: template.environmentVariables,
    isolationProfileId: check.isolationProfileId,
    isolationProfileDigest: check.isolationProfileDigest,
    timeoutMilliseconds: check.timeoutMilliseconds,
    terminationGraceMilliseconds: check.terminationGraceMilliseconds,
    stdoutLimitBytes: check.stdoutLimitBytes,
    stderrLimitBytes: check.stderrLimitBytes,
    totalOutputLimitBytes: check.totalOutputLimitBytes,
    payloadRetentionLimitBytes: check.payloadRetentionLimitBytes,
    acceptedExitCodes: check.acceptedExitCodes,
  });
  const expectedEnvironmentDigest = localCommandEnvironmentDigest(
    template.environmentVariables,
    digests,
  );
  if (
    canonicalizeJson(semanticProjection) !== canonicalizeJson(template) ||
    check.environmentDigest !== expectedEnvironmentDigest ||
    !exactValues(
      check.allowedEnvironmentVariables,
      template.environmentVariables.map(({ name }) => name),
    ) ||
    check.acceptanceCriticalVerificationPlanId !== plan.id ||
    check.acceptanceCriticalVerificationPlanDigest !== plan.planDigest ||
    check.protectedAssetManifestDigest !== plan.protectedAssetManifestDigest ||
    check.protectedAssetReadLeaseDigest !== lease.leaseDigest ||
    lease.acceptanceCriticalVerificationPlanId !== plan.id ||
    lease.acceptanceCriticalVerificationPlanDigest !== plan.planDigest ||
    lease.protectedAssetManifestDigest !== plan.protectedAssetManifestDigest ||
    lease.checkSpecificationId !== check.id ||
    lease.checkSpecificationVersion !== check.version ||
    sha256Digest(digests.digest(protectedAssetReadLeaseProjection(lease))) !== lease.leaseDigest
  ) {
    throw new TypeError('Protected local command Check does not derive exactly from its Plan');
  }
}
