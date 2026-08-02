import {
  acceptanceCriticalVerificationPlanId,
  candidateGenerationId,
  checkSpecificationId,
  executionProfileId,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  sha256Digest,
  successCriterionId,
  workflowId,
  workflowVersion,
  type AcceptanceCriticalVerificationPlanId,
  type CandidateGenerationId,
  type CheckSpecificationId,
  type ExecutionProfileId,
  type GoalId,
  type GoalRevision,
  type IsoTimestamp,
  type PolicyBundleId,
  type Sha256Digest,
  type SuccessCriterionId,
  type WorkflowId,
  type WorkflowVersion,
} from './identifiers.js';
import { z } from 'zod';

export const ProtectedAssetProtectionMode = {
  OUTSIDE_WORKER_WRITABLE_CANDIDATE: 'OUTSIDE_WORKER_WRITABLE_CANDIDATE',
} as const;
export type ProtectedAssetProtectionMode =
  (typeof ProtectedAssetProtectionMode)[keyof typeof ProtectedAssetProtectionMode];

export const ProtectedAssetReadLeaseAccessMode = { READ_ONLY: 'READ_ONLY' } as const;
export const ProtectedAssetReadLeaseLifecyclePolicy = {
  SINGLE_VERIFICATION_INVOCATION: 'SINGLE_VERIFICATION_INVOCATION',
} as const;
export const ProtectedAssetReadLeasePolicy = {
  EXACT_READ_ONLY_SINGLE_INVOCATION: 'EXACT_READ_ONLY_SINGLE_INVOCATION',
} as const;

export interface ProtectedVerificationAsset {
  readonly logicalAssetId: string;
  readonly registeredProtectedRootIdentity: string;
  readonly exactRealpath: string;
  readonly executionPath: string;
  /** Exact POSIX permission bits retained by the bounded local profile. */
  readonly fileMode: number;
  readonly byteLength: number;
  readonly contentDigest: Sha256Digest;
  readonly protectionMode: typeof ProtectedAssetProtectionMode.OUTSIDE_WORKER_WRITABLE_CANDIDATE;
}

/**
 * The immutable, generation-independent local-command semantics selected by
 * trusted composition. Runtime may add only Candidate/lease identity when it
 * creates a concrete schema-version-3 Check.
 */
export interface AcceptanceCriticalSemanticCheckTemplate {
  readonly schemaVersion: 1;
  readonly checkVersion: string;
  readonly producerIdentity: string;
  readonly operation: string;
  readonly runnerIdentity: string;
  readonly runnerVersion: string;
  readonly executablePath: string;
  readonly executableDigest: Sha256Digest;
  readonly declaredToolVersion: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly environmentVariables: readonly { readonly name: string; readonly value: string }[];
  readonly isolationProfileId: string;
  readonly isolationProfileDigest: Sha256Digest;
  readonly timeoutMilliseconds: number;
  readonly terminationGraceMilliseconds: number;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: number;
  readonly totalOutputLimitBytes: number;
  readonly payloadRetentionLimitBytes: number;
  readonly acceptedExitCodes: readonly number[];
}

export interface AcceptanceCriticalVerificationPlan {
  readonly schemaVersion: 1;
  readonly id: AcceptanceCriticalVerificationPlanId;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersionAtLock: WorkflowVersion;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly executionProfileId: ExecutionProfileId;
  readonly executionProfileDigest: Sha256Digest;
  readonly acceptanceCriticalCriterionIds: readonly SuccessCriterionId[];
  readonly acceptanceRuleIds: readonly string[];
  readonly semanticCheckTemplate: AcceptanceCriticalSemanticCheckTemplate;
  readonly protectedAssets: readonly ProtectedVerificationAsset[];
  readonly protectedAssetManifestDigest: Sha256Digest;
  readonly protectedAssetReadLeasePolicy: typeof ProtectedAssetReadLeasePolicy.EXACT_READ_ONLY_SINGLE_INVOCATION;
  readonly derivationRule: 'BOUNDED_M2_ONE_PROTECTED_LOCAL_COMMAND_FAMILY_V1';
  readonly authoritySource: 'TRUSTED_RUNTIME_COMPOSITION';
  readonly createdAt: IsoTimestamp;
  readonly planDigest: Sha256Digest;
}

export type AcceptanceCriticalVerificationPlanProposal = Pick<
  AcceptanceCriticalVerificationPlan,
  | 'acceptanceCriticalCriterionIds'
  | 'acceptanceRuleIds'
  | 'semanticCheckTemplate'
  | 'protectedAssets'
  | 'protectedAssetManifestDigest'
  | 'protectedAssetReadLeasePolicy'
  | 'derivationRule'
  | 'authoritySource'
>;

export interface ProtectedAssetReadLease {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly candidateGenerationId: CandidateGenerationId;
  readonly candidateDigest: Sha256Digest;
  readonly acceptanceCriticalVerificationPlanId: AcceptanceCriticalVerificationPlanId;
  readonly acceptanceCriticalVerificationPlanDigest: Sha256Digest;
  readonly protectedAssetManifestDigest: Sha256Digest;
  readonly checkSpecificationId: CheckSpecificationId;
  readonly checkSpecificationVersion: string;
  readonly isolationProfileId: string;
  readonly isolationProfileDigest: Sha256Digest;
  readonly accessMode: typeof ProtectedAssetReadLeaseAccessMode.READ_ONLY;
  readonly lifecyclePolicy: typeof ProtectedAssetReadLeaseLifecyclePolicy.SINGLE_VERIFICATION_INVOCATION;
  readonly assets: readonly ProtectedVerificationAsset[];
  readonly leaseDigest: Sha256Digest;
}

function nonBlank(value: string, name: string): void {
  if (value.trim().length === 0 || value.includes('\u0000')) {
    throw new TypeError(`${name} must be non-blank and contain no NUL byte`);
  }
}

function positive(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

function canonicalUnique(values: readonly string[], name: string): void {
  let previous: string | undefined;
  for (const value of values) {
    nonBlank(value, name);
    if (previous !== undefined && value <= previous) {
      throw new TypeError(`${name} must be uniquely sorted`);
    }
    previous = value;
  }
}

function exactAbsolutePath(value: string, name: string): void {
  nonBlank(value, name);
  if (!value.startsWith('/') || value !== value.normalize('NFC') || value.includes('/../')) {
    throw new TypeError(`${name} must be an exact normalized absolute path`);
  }
}

export function assertProtectedVerificationAssetInvariant(asset: ProtectedVerificationAsset): void {
  nonBlank(asset.logicalAssetId, 'Protected asset logical ID');
  exactAbsolutePath(asset.registeredProtectedRootIdentity, 'Protected root identity');
  exactAbsolutePath(asset.exactRealpath, 'Protected asset realpath');
  exactAbsolutePath(asset.executionPath, 'Protected asset execution path');
  if (!Number.isSafeInteger(asset.fileMode) || asset.fileMode < 0 || asset.fileMode > 0o7777) {
    throw new TypeError('Protected asset file mode is invalid');
  }
  if (!Number.isSafeInteger(asset.byteLength) || asset.byteLength < 0) {
    throw new TypeError('Protected asset byte length is invalid');
  }
  sha256Digest(asset.contentDigest);
}

function assertProtectedAssets(assets: readonly ProtectedVerificationAsset[]): void {
  if (assets.length === 0) {
    throw new TypeError('Protected verification requires at least one asset');
  }
  let previousKey: string | undefined;
  const paths = new Set<string>();
  for (const asset of assets) {
    assertProtectedVerificationAssetInvariant(asset);
    const key = `${asset.logicalAssetId}\u0000${asset.executionPath}`;
    if (previousKey !== undefined && key <= previousKey) {
      throw new TypeError('Protected assets must be uniquely ordered by logical ID and path');
    }
    if (paths.has(asset.exactRealpath) || paths.has(asset.executionPath)) {
      throw new TypeError('Protected assets cannot contain duplicate paths or aliases');
    }
    paths.add(asset.exactRealpath);
    paths.add(asset.executionPath);
    previousKey = key;
  }
}

export function assertAcceptanceCriticalSemanticCheckTemplateInvariant(
  template: AcceptanceCriticalSemanticCheckTemplate,
): void {
  for (const [value, name] of [
    [template.checkVersion, 'Check version'],
    [template.producerIdentity, 'Producer identity'],
    [template.operation, 'Operation'],
    [template.runnerIdentity, 'Runner identity'],
    [template.runnerVersion, 'Runner version'],
    [template.declaredToolVersion, 'Declared tool version'],
    [template.cwd, 'Check cwd'],
    [template.isolationProfileId, 'Isolation profile ID'],
  ] as const) {
    nonBlank(value, name);
  }
  exactAbsolutePath(template.executablePath, 'Executable path');
  sha256Digest(template.executableDigest);
  sha256Digest(template.isolationProfileDigest);
  if (template.argv.length === 0 || template.argv.length > 1_024) {
    throw new TypeError('Protected Check argv is empty or exceeds its bound');
  }
  for (const argument of template.argv) {
    nonBlank(argument, 'Protected Check argument');
  }
  canonicalUnique(
    template.environmentVariables.map(({ name }) => name),
    'Environment variable name',
  );
  for (const variable of template.environmentVariables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(variable.name) || variable.value.includes('\u0000')) {
      throw new TypeError('Protected Check environment variable is invalid');
    }
  }
  for (const [value, name] of [
    [template.timeoutMilliseconds, 'Timeout'],
    [template.terminationGraceMilliseconds, 'Termination grace'],
    [template.stdoutLimitBytes, 'stdout limit'],
    [template.stderrLimitBytes, 'stderr limit'],
    [template.totalOutputLimitBytes, 'total output limit'],
    [template.payloadRetentionLimitBytes, 'payload retention limit'],
  ] as const) {
    positive(value, name);
  }
  if (
    template.acceptedExitCodes.length === 0 ||
    new Set(template.acceptedExitCodes).size !== template.acceptedExitCodes.length ||
    template.acceptedExitCodes.some((code) => !Number.isInteger(code) || code < 0 || code > 255)
  ) {
    throw new TypeError('Protected Check accepted exit codes are invalid');
  }
}

export function protectedAssetManifestProjection(
  assets: readonly ProtectedVerificationAsset[],
): unknown {
  assertProtectedAssets(assets);
  return { schemaVersion: 1, assets };
}

export function acceptanceCriticalVerificationPlanProjection(
  plan: AcceptanceCriticalVerificationPlan | Omit<AcceptanceCriticalVerificationPlan, 'planDigest'>,
): Omit<AcceptanceCriticalVerificationPlan, 'planDigest'> {
  if ('planDigest' in plan) {
    sha256Digest(plan.planDigest);
    const { planDigest, ...fields } = plan;
    void planDigest;
    return fields;
  }
  return plan;
}

export function assertAcceptanceCriticalVerificationPlanInvariant(
  plan: AcceptanceCriticalVerificationPlan,
): void {
  acceptanceCriticalVerificationPlanId(plan.id);
  goalId(plan.goalId);
  goalRevision(plan.goalRevision);
  workflowId(plan.workflowId);
  workflowVersion(plan.workflowVersionAtLock);
  policyBundleId(plan.policyBundleId);
  sha256Digest(plan.policyBundleDigest);
  executionProfileId(plan.executionProfileId);
  sha256Digest(plan.executionProfileDigest);
  if (plan.acceptanceCriticalCriterionIds.length === 0 || plan.acceptanceRuleIds.length === 0) {
    throw new TypeError('Protected Verification Plan requires complete Criterion and rule sets');
  }
  for (const id of plan.acceptanceCriticalCriterionIds) {
    successCriterionId(id);
  }
  canonicalUnique(plan.acceptanceCriticalCriterionIds, 'Critical Criterion ID');
  canonicalUnique(plan.acceptanceRuleIds, 'Acceptance rule ID');
  assertAcceptanceCriticalSemanticCheckTemplateInvariant(plan.semanticCheckTemplate);
  assertProtectedAssets(plan.protectedAssets);
  sha256Digest(plan.protectedAssetManifestDigest);
  isoTimestamp(plan.createdAt);
  sha256Digest(plan.planDigest);
}

export function protectedAssetReadLeaseProjection(
  lease: ProtectedAssetReadLease | Omit<ProtectedAssetReadLease, 'leaseDigest'>,
): Omit<ProtectedAssetReadLease, 'leaseDigest'> {
  if ('leaseDigest' in lease) {
    sha256Digest(lease.leaseDigest);
    const { leaseDigest, ...fields } = lease;
    void leaseDigest;
    return fields;
  }
  return lease;
}

export function assertProtectedAssetReadLeaseInvariant(lease: ProtectedAssetReadLease): void {
  goalId(lease.goalId);
  goalRevision(lease.goalRevision);
  workflowId(lease.workflowId);
  candidateGenerationId(lease.candidateGenerationId);
  sha256Digest(lease.candidateDigest);
  acceptanceCriticalVerificationPlanId(lease.acceptanceCriticalVerificationPlanId);
  sha256Digest(lease.acceptanceCriticalVerificationPlanDigest);
  sha256Digest(lease.protectedAssetManifestDigest);
  checkSpecificationId(lease.checkSpecificationId);
  nonBlank(lease.checkSpecificationVersion, 'Protected lease Check version');
  nonBlank(lease.isolationProfileId, 'Protected lease isolation profile ID');
  sha256Digest(lease.isolationProfileDigest);
  assertProtectedAssets(lease.assets);
  sha256Digest(lease.leaseDigest);
}

const boundedNonBlank = z
  .string()
  .min(1)
  .max(16_384)
  .refine((value) => value.trim().length > 0 && !value.includes('\u0000'));
const assetSchema = z
  .object({
    logicalAssetId: boundedNonBlank,
    registeredProtectedRootIdentity: boundedNonBlank,
    exactRealpath: boundedNonBlank,
    executionPath: boundedNonBlank,
    fileMode: z.number().int().nonnegative().max(0o7777),
    byteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    contentDigest: z.string(),
    protectionMode: z.literal(ProtectedAssetProtectionMode.OUTSIDE_WORKER_WRITABLE_CANDIDATE),
  })
  .strict();
const environmentVariableSchema = z
  .object({ name: boundedNonBlank, value: z.string().max(65_536) })
  .strict();
const semanticCheckTemplateSchema = z
  .object({
    schemaVersion: z.literal(1),
    checkVersion: boundedNonBlank,
    producerIdentity: boundedNonBlank,
    operation: boundedNonBlank,
    runnerIdentity: boundedNonBlank,
    runnerVersion: boundedNonBlank,
    executablePath: boundedNonBlank,
    executableDigest: z.string(),
    declaredToolVersion: boundedNonBlank,
    argv: z.array(z.string().max(16_384)).min(1).max(1_024),
    cwd: boundedNonBlank,
    environmentVariables: z.array(environmentVariableSchema).max(1_024),
    isolationProfileId: boundedNonBlank,
    isolationProfileDigest: z.string(),
    timeoutMilliseconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    terminationGraceMilliseconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    stdoutLimitBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    stderrLimitBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    totalOutputLimitBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    payloadRetentionLimitBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    acceptedExitCodes: z.array(z.number().int().min(0).max(255)).min(1).max(256),
  })
  .strict();

function decodeAsset(value: unknown): ProtectedVerificationAsset {
  const parsed = assetSchema.parse(value);
  const asset = Object.freeze({ ...parsed, contentDigest: sha256Digest(parsed.contentDigest) });
  assertProtectedVerificationAssetInvariant(asset);
  return asset;
}

export function decodeAcceptanceCriticalSemanticCheckTemplate(
  value: unknown,
): AcceptanceCriticalSemanticCheckTemplate {
  const parsed = semanticCheckTemplateSchema.parse(value);
  const template: AcceptanceCriticalSemanticCheckTemplate = Object.freeze({
    ...parsed,
    executableDigest: sha256Digest(parsed.executableDigest),
    argv: Object.freeze([...parsed.argv]),
    environmentVariables: Object.freeze(
      parsed.environmentVariables.map((variable) => Object.freeze({ ...variable })),
    ),
    isolationProfileDigest: sha256Digest(parsed.isolationProfileDigest),
    acceptedExitCodes: Object.freeze([...parsed.acceptedExitCodes]),
  });
  assertAcceptanceCriticalSemanticCheckTemplateInvariant(template);
  return template;
}

const planSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    goalId: z.string(),
    goalRevision: z.number().int().positive(),
    workflowId: z.string(),
    workflowVersionAtLock: z.number().int().positive(),
    policyBundleId: z.string(),
    policyBundleDigest: z.string(),
    executionProfileId: z.string(),
    executionProfileDigest: z.string(),
    acceptanceCriticalCriterionIds: z.array(z.string()).min(1),
    acceptanceRuleIds: z.array(boundedNonBlank).min(1),
    semanticCheckTemplate: z.unknown(),
    protectedAssets: z.array(z.unknown()).min(1),
    protectedAssetManifestDigest: z.string(),
    protectedAssetReadLeasePolicy: z.literal(
      ProtectedAssetReadLeasePolicy.EXACT_READ_ONLY_SINGLE_INVOCATION,
    ),
    derivationRule: z.literal('BOUNDED_M2_ONE_PROTECTED_LOCAL_COMMAND_FAMILY_V1'),
    authoritySource: z.literal('TRUSTED_RUNTIME_COMPOSITION'),
    createdAt: z.string(),
    planDigest: z.string(),
  })
  .strict();

export function decodeAcceptanceCriticalVerificationPlan(
  value: unknown,
): AcceptanceCriticalVerificationPlan {
  const parsed = planSchema.parse(value);
  const plan: AcceptanceCriticalVerificationPlan = Object.freeze({
    ...parsed,
    id: acceptanceCriticalVerificationPlanId(parsed.id),
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    workflowId: workflowId(parsed.workflowId),
    workflowVersionAtLock: workflowVersion(parsed.workflowVersionAtLock),
    policyBundleId: policyBundleId(parsed.policyBundleId),
    policyBundleDigest: sha256Digest(parsed.policyBundleDigest),
    executionProfileId: executionProfileId(parsed.executionProfileId),
    executionProfileDigest: sha256Digest(parsed.executionProfileDigest),
    acceptanceCriticalCriterionIds: Object.freeze(
      parsed.acceptanceCriticalCriterionIds.map((id) => successCriterionId(id)),
    ),
    acceptanceRuleIds: Object.freeze([...parsed.acceptanceRuleIds]),
    semanticCheckTemplate: decodeAcceptanceCriticalSemanticCheckTemplate(
      parsed.semanticCheckTemplate,
    ),
    protectedAssets: Object.freeze(parsed.protectedAssets.map((asset) => decodeAsset(asset))),
    protectedAssetManifestDigest: sha256Digest(parsed.protectedAssetManifestDigest),
    createdAt: isoTimestamp(parsed.createdAt),
    planDigest: sha256Digest(parsed.planDigest),
  });
  assertAcceptanceCriticalVerificationPlanInvariant(plan);
  return plan;
}

const planProposalSchema = z
  .object({
    acceptanceCriticalCriterionIds: z.array(z.string()).min(1),
    acceptanceRuleIds: z.array(boundedNonBlank).min(1),
    semanticCheckTemplate: z.unknown(),
    protectedAssets: z.array(z.unknown()).min(1),
    protectedAssetManifestDigest: z.string(),
    protectedAssetReadLeasePolicy: z.literal(
      ProtectedAssetReadLeasePolicy.EXACT_READ_ONLY_SINGLE_INVOCATION,
    ),
    derivationRule: z.literal('BOUNDED_M2_ONE_PROTECTED_LOCAL_COMMAND_FAMILY_V1'),
    authoritySource: z.literal('TRUSTED_RUNTIME_COMPOSITION'),
  })
  .strict();

export function decodeAcceptanceCriticalVerificationPlanProposal(
  value: unknown,
): AcceptanceCriticalVerificationPlanProposal {
  const parsed = planProposalSchema.parse(value);
  const proposal = Object.freeze({
    acceptanceCriticalCriterionIds: Object.freeze(
      parsed.acceptanceCriticalCriterionIds.map((id) => successCriterionId(id)),
    ),
    acceptanceRuleIds: Object.freeze([...parsed.acceptanceRuleIds]),
    semanticCheckTemplate: decodeAcceptanceCriticalSemanticCheckTemplate(
      parsed.semanticCheckTemplate,
    ),
    protectedAssets: Object.freeze(parsed.protectedAssets.map((asset) => decodeAsset(asset))),
    protectedAssetManifestDigest: sha256Digest(parsed.protectedAssetManifestDigest),
    protectedAssetReadLeasePolicy: parsed.protectedAssetReadLeasePolicy,
    derivationRule: parsed.derivationRule,
    authoritySource: parsed.authoritySource,
  });
  canonicalUnique(proposal.acceptanceCriticalCriterionIds, 'Critical Criterion ID');
  canonicalUnique(proposal.acceptanceRuleIds, 'Acceptance rule ID');
  return proposal;
}

const leaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    goalId: z.string(),
    goalRevision: z.number().int().positive(),
    workflowId: z.string(),
    candidateGenerationId: z.string(),
    candidateDigest: z.string(),
    acceptanceCriticalVerificationPlanId: z.string(),
    acceptanceCriticalVerificationPlanDigest: z.string(),
    protectedAssetManifestDigest: z.string(),
    checkSpecificationId: z.string(),
    checkSpecificationVersion: boundedNonBlank,
    isolationProfileId: boundedNonBlank,
    isolationProfileDigest: z.string(),
    accessMode: z.literal(ProtectedAssetReadLeaseAccessMode.READ_ONLY),
    lifecyclePolicy: z.literal(
      ProtectedAssetReadLeaseLifecyclePolicy.SINGLE_VERIFICATION_INVOCATION,
    ),
    assets: z.array(z.unknown()).min(1),
    leaseDigest: z.string(),
  })
  .strict();

export function decodeProtectedAssetReadLease(value: unknown): ProtectedAssetReadLease {
  const parsed = leaseSchema.parse(value);
  const lease: ProtectedAssetReadLease = Object.freeze({
    ...parsed,
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    workflowId: workflowId(parsed.workflowId),
    candidateGenerationId: candidateGenerationId(parsed.candidateGenerationId),
    candidateDigest: sha256Digest(parsed.candidateDigest),
    acceptanceCriticalVerificationPlanId: acceptanceCriticalVerificationPlanId(
      parsed.acceptanceCriticalVerificationPlanId,
    ),
    acceptanceCriticalVerificationPlanDigest: sha256Digest(
      parsed.acceptanceCriticalVerificationPlanDigest,
    ),
    protectedAssetManifestDigest: sha256Digest(parsed.protectedAssetManifestDigest),
    checkSpecificationId: checkSpecificationId(parsed.checkSpecificationId),
    isolationProfileDigest: sha256Digest(parsed.isolationProfileDigest),
    assets: Object.freeze(parsed.assets.map((asset) => decodeAsset(asset))),
    leaseDigest: sha256Digest(parsed.leaseDigest),
  });
  assertProtectedAssetReadLeaseInvariant(lease);
  return lease;
}
