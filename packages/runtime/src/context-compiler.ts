import {
  AttemptStatus,
  ContextAuthorityClass,
  ContextEntryKind,
  RunStatus,
  WorkerResultKind,
  WorkflowPhase,
  candidateGenerationId,
  contextManifestId,
  assertContextEntryAuthorityInvariant,
  decodeAttemptSnapshot,
  decodeContextManifest,
  decodeContextPackage,
  decodeGoalSnapshot,
  decodeWorkflowSnapshot,
  deriveGoalStatus,
  isoTimestamp,
  policyBundleId,
  sha256Digest,
  type Attempt,
  type CandidateGenerationId,
  type ContextCompilation,
  type ContextManifest,
  type ContextManifestEntry,
  type ContextManifestId,
  type ContextOmissionDecision,
  type ContextPackageEntry,
  type Goal,
  type IsoTimestamp,
  type PolicyBundleId,
  type Sha256Digest,
  type WorkerResponseContract,
  type WorkflowInstance,
  type WorkflowPhase as WorkflowPhaseType,
} from '@codeclosure/domain';

import type { Canonicalizer, DigestProvider } from './ports.js';

export interface ContextCandidateBinding {
  readonly generationId: CandidateGenerationId;
  readonly digest: Sha256Digest;
}

export type ContextSourceInput = ContextPackageEntry;

export interface CompileContextInput {
  readonly manifestId: ContextManifestId;
  readonly createdAt: IsoTimestamp;
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
  readonly attempt: Attempt;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly selectedEntries?: readonly ContextSourceInput[];
  readonly omissionDecisions?: readonly ContextOmissionDecision[];
  readonly candidate?: ContextCandidateBinding;
}

export interface MinimalContextCompilerOptions {
  readonly compilerVersion: string;
  readonly maxPackageBytes: number;
  readonly canonicalizer: Canonicalizer;
  readonly digests: DigestProvider;
}

const phaseObjectives: Readonly<Partial<Record<WorkflowPhaseType, string>>> = Object.freeze({
  [WorkflowPhase.DISCOVERY]:
    'Inspect the bounded project and submit evidence-labelled discovery proposals.',
  [WorkflowPhase.PLAN]:
    'Produce a bounded implementation and verification proposal for the current Goal revision.',
  [WorkflowPhase.IMPLEMENT]:
    'Work only inside the current mutable Candidate boundary and submit a completion request.',
});

function compareKey(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function entryKey(
  entry: Pick<ContextPackageEntry, 'kind' | 'sourceRef' | 'sourceRevision'>,
): string {
  return `${entry.kind}\u0000${entry.sourceRef}\u0000${entry.sourceRevision}`;
}

function omissionKey(decision: ContextOmissionDecision): string {
  return `${decision.sourceRef}\u0000${decision.selectionRule}\u0000${decision.reason}`;
}

function freezeEntry(entry: ContextPackageEntry): ContextPackageEntry {
  return Object.freeze({
    kind: entry.kind,
    sourceRef: entry.sourceRef,
    sourceRevision: entry.sourceRevision,
    ...(entry.sourceDigest === undefined ? {} : { sourceDigest: entry.sourceDigest }),
    authorityClass: entry.authorityClass,
    renderedContent: entry.renderedContent,
  });
}

function canonicalEntries(entries: readonly ContextSourceInput[]): readonly ContextPackageEntry[] {
  const materialized = entries
    .map((entry) => freezeEntry(entry))
    .sort((left, right) => compareKey(entryKey(left), entryKey(right)));
  let previous: string | undefined;
  for (const entry of materialized) {
    const key = entryKey(entry);
    if (key === previous) {
      throw new TypeError('Context entries must have unique kind/source/revision identity');
    }
    previous = key;
    switch (entry.kind) {
      case ContextEntryKind.GOAL:
      case ContextEntryKind.SUCCESS_CRITERION:
      case ContextEntryKind.CANDIDATE:
        throw new TypeError(`${entry.kind} entries are compiler-owned`);
    }
    assertContextEntryAuthorityInvariant(entry);
  }
  return Object.freeze(materialized);
}

function canonicalOmissions(
  omissions: readonly ContextOmissionDecision[],
): readonly ContextOmissionDecision[] {
  const materialized = omissions
    .map((decision) => Object.freeze({ ...decision }))
    .sort((left, right) => compareKey(omissionKey(left), omissionKey(right)));
  let previous: string | undefined;
  const sourceRefs = new Set<string>();
  for (const decision of materialized) {
    const key = omissionKey(decision);
    if (key === previous) {
      throw new TypeError('Context omission decisions must be unique');
    }
    if (sourceRefs.has(decision.sourceRef)) {
      throw new TypeError('Context omission decisions must identify unique sources');
    }
    sourceRefs.add(decision.sourceRef);
    previous = key;
  }
  return Object.freeze(materialized);
}

export function m1PhaseObjective(phase: WorkflowPhaseType): string {
  const objective = phaseObjectives[phase];
  if (objective === undefined) {
    throw new TypeError(`Phase ${phase} has no M1 Worker objective`);
  }
  return objective;
}

export function m1WorkerResponseContract(phase: WorkflowPhaseType): WorkerResponseContract {
  const allowedResultKinds =
    phase === WorkflowPhase.IMPLEMENT
      ? [WorkerResultKind.COMPLETION_REQUEST]
      : phase === WorkflowPhase.DISCOVERY || phase === WorkflowPhase.PLAN
        ? [WorkerResultKind.PROPOSALS]
        : undefined;
  if (allowedResultKinds === undefined) {
    throw new TypeError(`Phase ${phase} does not dispatch an implementation Worker in M1`);
  }
  return Object.freeze({
    schemaVersion: 1,
    workerEventSchemaVersion: 1,
    allowedResultKinds: Object.freeze(allowedResultKinds),
    unknownFields: 'REJECT',
    maxEventBytes: 65_536,
  });
}

export function deriveContextManifestEntries(
  rawContextPackage: Parameters<typeof decodeContextPackage>[0],
  digests: DigestProvider,
): readonly ContextManifestEntry[] {
  const contextPackage = decodeContextPackage(rawContextPackage);
  const digest = (value: unknown): Sha256Digest => sha256Digest(digests.digest(value));
  const entries: ContextManifestEntry[] = [
    Object.freeze({
      kind: ContextEntryKind.GOAL,
      sourceRef: contextPackage.goalId,
      sourceRevision: String(contextPackage.goalRevision),
      authorityClass: ContextAuthorityClass.GOAL_AUTHORITY,
      renderedDigest: digest(contextPackage.goal),
    }),
    ...contextPackage.goal.successCriteria.map((criterion) =>
      Object.freeze({
        kind: ContextEntryKind.SUCCESS_CRITERION,
        sourceRef: criterion.id,
        sourceRevision: String(contextPackage.goalRevision),
        authorityClass: ContextAuthorityClass.GOAL_AUTHORITY,
        renderedDigest: digest(criterion),
      }),
    ),
    ...contextPackage.selectedEntries.map((entry) =>
      Object.freeze({
        kind: entry.kind,
        sourceRef: entry.sourceRef,
        sourceRevision: entry.sourceRevision,
        ...(entry.sourceDigest === undefined ? {} : { sourceDigest: entry.sourceDigest }),
        authorityClass: entry.authorityClass,
        renderedDigest: digest({ schemaVersion: 1, renderedContent: entry.renderedContent }),
      }),
    ),
    ...(contextPackage.candidateGenerationId === undefined ||
    contextPackage.candidateDigest === undefined
      ? []
      : [
          Object.freeze({
            kind: ContextEntryKind.CANDIDATE,
            sourceRef: contextPackage.candidateGenerationId,
            sourceRevision: String(contextPackage.workflowVersion),
            sourceDigest: contextPackage.candidateDigest,
            authorityClass: ContextAuthorityClass.PROJECT_OBSERVATION,
            renderedDigest: digest({
              generationId: contextPackage.candidateGenerationId,
              digest: contextPackage.candidateDigest,
            }),
          }),
        ]),
  ];
  entries.sort((left, right) => compareKey(entryKey(left), entryKey(right)));
  return Object.freeze(entries);
}

export function contextManifestDigestProjection(
  manifest: Omit<ContextManifest, 'id' | 'createdAt' | 'manifestDigest'>,
): unknown {
  return {
    schemaVersion: manifest.schemaVersion,
    compilerVersion: manifest.compilerVersion,
    goalId: manifest.goalId,
    goalRevision: manifest.goalRevision,
    workflowId: manifest.workflowId,
    workflowVersion: manifest.workflowVersion,
    phase: manifest.phase,
    attemptId: manifest.attemptId,
    ...(manifest.candidateGenerationId === undefined
      ? {}
      : { candidateGenerationId: manifest.candidateGenerationId }),
    ...(manifest.candidateDigest === undefined
      ? {}
      : { candidateDigest: manifest.candidateDigest }),
    policyBundleId: manifest.policyBundleId,
    policyBundleDigest: manifest.policyBundleDigest,
    capabilityGrantDigest: manifest.capabilityGrantDigest,
    responseContractDigest: manifest.responseContractDigest,
    entries: manifest.entries,
    omissionDecisions: manifest.omissionDecisions,
    packageDigest: manifest.packageDigest,
  };
}

export class MinimalContextCompiler {
  readonly #compilerVersion: string;
  readonly #maxPackageBytes: number;
  readonly #canonicalizer: Canonicalizer;
  readonly #digests: DigestProvider;

  public constructor(options: MinimalContextCompilerOptions) {
    if (options.compilerVersion.trim().length === 0) {
      throw new TypeError('compilerVersion must not be blank');
    }
    if (!Number.isSafeInteger(options.maxPackageBytes) || options.maxPackageBytes < 1) {
      throw new TypeError('maxPackageBytes must be a positive safe integer');
    }
    this.#compilerVersion = options.compilerVersion;
    this.#maxPackageBytes = options.maxPackageBytes;
    this.#canonicalizer = options.canonicalizer;
    this.#digests = options.digests;
  }

  public compile(rawInput: CompileContextInput): ContextCompilation {
    const manifestIdentifier = contextManifestId(rawInput.manifestId);
    const createdAt = isoTimestamp(rawInput.createdAt);
    const goal = decodeGoalSnapshot(rawInput.goal);
    const workflow = decodeWorkflowSnapshot(rawInput.workflow);
    const attempt = decodeAttemptSnapshot(rawInput.attempt);
    const policyIdentifier = policyBundleId(rawInput.policyBundleId);
    const policyDigest = sha256Digest(rawInput.policyBundleDigest);

    if (
      workflow.goalId !== goal.id ||
      workflow.goalRevision !== goal.revision ||
      goal.status !== deriveGoalStatus(workflow.runStatus)
    ) {
      throw new TypeError('Context inputs do not share one Goal/Workflow authority');
    }
    if (
      workflow.runStatus !== RunStatus.RUNNING ||
      workflow.activeAttemptId !== attempt.id ||
      attempt.status !== AttemptStatus.RUNNING ||
      attempt.workflowId !== workflow.id ||
      attempt.phase !== workflow.phase ||
      attempt.contextManifestId !== manifestIdentifier
    ) {
      throw new TypeError('Context Attempt is not the active bound RUNNING Attempt');
    }
    if (createdAt < workflow.updatedAt || createdAt < attempt.startedAt) {
      throw new TypeError('Context Manifest cannot predate its Workflow or Attempt');
    }

    const candidate = rawInput.candidate;
    if (
      (workflow.activeCandidateGenerationId === undefined) !== (candidate === undefined) ||
      (candidate !== undefined && candidate.generationId !== workflow.activeCandidateGenerationId)
    ) {
      throw new TypeError('Context Candidate does not match the active Workflow generation');
    }
    const candidateBinding =
      candidate === undefined
        ? undefined
        : Object.freeze({
            generationId: candidateGenerationId(candidate.generationId),
            digest: sha256Digest(candidate.digest),
          });

    const selectedEntries = canonicalEntries(rawInput.selectedEntries ?? []);
    const omissionDecisions = canonicalOmissions(rawInput.omissionDecisions ?? []);
    const contract = m1WorkerResponseContract(workflow.phase);
    const objective = m1PhaseObjective(workflow.phase);
    const includedSourceRefs = new Set<string>([
      goal.id,
      ...goal.successCriteria.map((criterion) => criterion.id),
      ...selectedEntries.map((entry) => entry.sourceRef),
      ...(candidateBinding === undefined ? [] : [candidateBinding.generationId]),
    ]);
    for (const omission of omissionDecisions) {
      if (includedSourceRefs.has(omission.sourceRef)) {
        throw new TypeError(`Context source ${omission.sourceRef} cannot be selected and omitted`);
      }
    }

    const contextPackage = decodeContextPackage({
      schemaVersion: 1,
      goalId: goal.id,
      goalRevision: goal.revision,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      phase: workflow.phase,
      attemptId: attempt.id,
      ...(candidateBinding === undefined
        ? {}
        : {
            candidateGenerationId: candidateBinding.generationId,
            candidateDigest: candidateBinding.digest,
          }),
      phaseObjective: objective,
      capabilityGrant: attempt.capabilityGrant,
      goal: {
        objective: goal.objective,
        successCriteria: goal.successCriteria,
        scope: goal.scope,
        nonGoals: goal.nonGoals,
      },
      selectedEntries,
      policyBundleId: policyIdentifier,
      policyBundleDigest: policyDigest,
      responseContract: contract,
    });

    const canonicalPackage = this.#canonicalizer.canonicalize(contextPackage);
    if (Buffer.byteLength(canonicalPackage, 'utf8') > this.#maxPackageBytes) {
      throw new RangeError('Required Context Package exceeds the configured hard byte budget');
    }

    const digest = (value: unknown): Sha256Digest => sha256Digest(this.#digests.digest(value));
    const packageDigest = digest(contextPackage);
    const capabilityGrantDigest = digest({
      schemaVersion: 1,
      capabilityGrant: contextPackage.capabilityGrant,
    });
    const responseContractDigest = digest({
      schemaVersion: 1,
      responseContract: contract,
    });

    const synthesizedEntries = deriveContextManifestEntries(contextPackage, this.#digests);

    const manifestWithoutDigest = {
      schemaVersion: 1 as const,
      compilerVersion: this.#compilerVersion,
      goalId: goal.id,
      goalRevision: goal.revision,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      phase: workflow.phase,
      attemptId: attempt.id,
      ...(candidateBinding === undefined
        ? {}
        : {
            candidateGenerationId: candidateBinding.generationId,
            candidateDigest: candidateBinding.digest,
          }),
      policyBundleId: policyIdentifier,
      policyBundleDigest: policyDigest,
      capabilityGrantDigest,
      responseContractDigest,
      entries: Object.freeze(synthesizedEntries),
      omissionDecisions,
      packageDigest,
    };
    const manifest = decodeContextManifest({
      id: manifestIdentifier,
      createdAt,
      ...manifestWithoutDigest,
      manifestDigest: digest(contextManifestDigestProjection(manifestWithoutDigest)),
    });

    return Object.freeze({ package: contextPackage, manifest });
  }
}
