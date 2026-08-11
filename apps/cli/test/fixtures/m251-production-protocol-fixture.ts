import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import {
  createCodexWorkerDirectiveV3,
  decodeCodexCandidateWorkspaceLease,
  type CodexWorkerDirectiveV3,
  type CodexWorkerPhaseDirectiveV1,
  type CodexWorkerRequestBindingV3,
  type CodexWorkerSourceAuthorityV1,
} from '@codeclosure/adapter-codex';
import {
  CandidateGenerationState,
  ExternalBackendCapability,
  ExternalBackendCapabilityClassification,
  ExternalPhaseSourceAuthorityKind,
  ExternalThreadPolicy,
  RunStatus,
  WorkerResultKind,
  WorkflowPhase,
  externalBackendCapabilityRecordProjection,
  externalProcessIdentityProjection,
  isoTimestamp,
  sha256Digest,
  workerEventId,
  type ExternalBackendCapabilityRecord,
  type ExternalExecutionProfileDefinitionV3,
} from '@codeclosure/domain';
import {
  CandidateWorkspaceAccessMode,
  CanonicalJsonSha256DigestProvider,
  canonicalizeJson,
  decodeCandidateWorkspaceLease,
  decodeWorkerEvent,
  type ExternalObservedWorkerPort,
  type ExternalWorkerInvocationPort,
  type PreparedExternalWorkerInvocation,
  type WorkerRequest,
} from '@codeclosure/runtime';

import type { M251ProductionActivation } from '../../dist/composition/m251-trusted-production-composition.js';
import type { M251ExternalWorkerFactoryInput } from '../../dist/composition/m251-trusted-production-composition.js';

const digests = new CanonicalJsonSha256DigestProvider();
const protocolDigest = 'sha256:312156edfdf765f134ce5f754419a9509fd34186798a1bdbb0c219ac7c19c610';

export interface M251ProductionProtocolFixtureObservation {
  readonly directives: readonly CodexWorkerDirectiveV3[];
  readonly phaseRuns: readonly string[];
  readonly prepareCount: number;
  readonly releaseCount: number;
}

export interface M251ProductionProtocolFixtureActivation {
  readonly activation: M251ProductionActivation;
  observation(): M251ProductionProtocolFixtureObservation;
}

function requestBinding(request: WorkerRequest): CodexWorkerRequestBindingV3 {
  const context = request.contextPackage;
  const base = {
    attemptId: request.attemptId,
    contextManifestDigest: request.contextManifestDigest,
    contextManifestId: request.contextManifestId,
    executionProfileDigest: request.executionProfileDigest,
    executionProfileId: request.executionProfileId,
    goalId: context.goalId,
    goalRevision: context.goalRevision,
    packageDigest: request.packageDigest,
    policyBundleDigest: context.policyBundleDigest,
    policyBundleId: context.policyBundleId,
    workerSessionId: request.workerSessionId,
    workflowId: context.workflowId,
    workflowVersion: context.workflowVersion,
  };
  if (context.phase === WorkflowPhase.IMPLEMENT) {
    if (context.candidateGenerationId === undefined || context.candidateDigest === undefined) {
      throw new TypeError('Protocol fixture IMPLEMENT request has no Candidate binding');
    }
    return Object.freeze({
      ...base,
      candidateDigest: context.candidateDigest,
      candidateGenerationId: context.candidateGenerationId,
      phase: context.phase,
    });
  }
  if (context.phase !== WorkflowPhase.DISCOVERY && context.phase !== WorkflowPhase.PLAN) {
    throw new TypeError('Protocol fixture selected a non-Worker phase');
  }
  return Object.freeze({ ...base, phase: context.phase });
}

function eventFor(request: WorkerRequest) {
  const hash = createHash('sha256')
    .update(`${request.workerSessionId}\u0000${request.attemptId}`, 'utf8')
    .digest('hex')
    .slice(0, 24);
  return decodeWorkerEvent({
    schemaVersion: 1,
    id: workerEventId(`worker-event_m251-b4-${hash}`),
    workerSessionId: request.workerSessionId,
    attemptId: request.attemptId,
    contextManifestId: request.contextManifestId,
    contextManifestDigest: request.contextManifestDigest,
    packageDigest: request.packageDigest,
    observedAt: isoTimestamp('2026-08-11T00:00:00.000Z'),
    type: 'WORKER_RESULT',
    result:
      request.contextPackage.phase === WorkflowPhase.IMPLEMENT
        ? Object.freeze({
            kind: WorkerResultKind.COMPLETION_REQUEST,
            claimedScope: request.contextPackage.goal.objective,
            summary: 'Protocol fixture requests governed verification of the Candidate.',
            proposedEvidenceRefs: Object.freeze([]),
          })
        : Object.freeze({
            kind: WorkerResultKind.PROPOSALS,
            proposals: Object.freeze([
              Object.freeze({
                kind: 'PROJECT_OBSERVATION',
                summary: 'Protocol fixture produced one source-bound proposal.',
                sourceRefs: Object.freeze([request.contextPackage.goal.scope.projectPath]),
              }),
            ]),
          }),
  });
}

function correctedPaymentSource(): string {
  return `export class PaymentProcessor {
  #charges = [];
  #orders = new Set();

  processCallback({ orderId, amount }) {
    if (this.#orders.has(orderId)) return { status: 'duplicate_ignored' };
    this.#orders.add(orderId);
    this.#charges.push({ orderId, amount });
    return { status: 'charged' };
  }

  getCharges() {
    return [...this.#charges];
  }
}
`;
}

function rejectedPaymentSource(): string {
  return `export class PaymentProcessor {
  #charges = [];

  processCallback({ orderId, amount }) {
    const charge = { orderId, amount };
    this.#charges.push(charge);
    return { status: 'charged' };
  }

  getCharges() {
    return [...this.#charges];
  }
}
`;
}

export function createM251ProductionProtocolFixtureActivation(
  input: Readonly<{
    candidateWorkspaceRoot: string;
    implementationResult?: 'CONTAINMENT_FAILURE' | 'CORRECT' | 'VERIFICATION_REJECTED';
    operationRoots: readonly string[];
    phaseForbiddenRoots: Readonly<
      Record<
        typeof WorkflowPhase.DISCOVERY | typeof WorkflowPhase.PLAN | typeof WorkflowPhase.IMPLEMENT,
        readonly string[]
      >
    >;
    projectReadWorkspaceRoot: string;
  }>,
): M251ProductionProtocolFixtureActivation {
  const binaryDigest = digests.digest({ fixture: 'm251-b4', kind: 'binary' });
  const configurationDigest = digests.digest({ fixture: 'm251-b4', kind: 'configuration' });
  const withoutCapabilityDigest = Object.freeze({
    schemaVersion: 1 as const,
    backendKind: 'CODEX_APP_SERVER',
    binaryIdentityDigest: binaryDigest,
    protocolSchemaDigest: sha256Digest(protocolDigest),
    configurationProfileDigest: configurationDigest,
    capabilityEntries: Object.freeze(
      [
        ExternalBackendCapability.CONTROLLED_STATE_REOPEN,
        ExternalBackendCapability.FRESH_SESSION,
        ExternalBackendCapability.OPERATION_INTERRUPT,
        ExternalBackendCapability.SAME_SESSION_BOUNDED_OPERATION,
      ]
        .toSorted()
        .map((capability) =>
          Object.freeze({
            capability,
            classification: ExternalBackendCapabilityClassification.SUPPORTED,
            proofKind: 'EXPLICIT_M251_B4_PROTOCOL_FIXTURE',
          }),
        ),
    ),
    observedAt: isoTimestamp('2026-08-11T00:00:00.000Z'),
  });
  const capabilityRecord: ExternalBackendCapabilityRecord = Object.freeze({
    ...withoutCapabilityDigest,
    recordDigest: digests.digest(
      externalBackendCapabilityRecordProjection(withoutCapabilityDigest),
    ),
  });
  const permissionDigest = digests.digest({ fixture: 'm251-b4', kind: 'permission' });
  const executionConfigDigest = digests.digest({ fixture: 'm251-b4', kind: 'config-read' });
  const instructionSources = Object.freeze([]);
  const sharedProfile = Object.freeze({
    codexVersion: 'codex-cli 0.146.1',
    controlledStateRootIdentity: input.operationRoots[0] ?? '',
    delegatedExecutableDigest: binaryDigest,
    environmentNames: Object.freeze(['CODEX_HOME', 'HOME', 'PATH', 'TMPDIR']),
    launcherDigest: digests.digest({ fixture: 'm251-b4', kind: 'launcher' }),
    managedRequirementsDigest: digests.digest({ fixture: 'm251-b4', kind: 'requirements' }),
    maximumPromptBytes: 256 * 1024,
    model: 'gpt-fixture',
    modelProvider: 'openai',
    nonSecretEnvironmentDigest: digests.digest({ fixture: 'm251-b4', kind: 'environment' }),
    protocolSnapshotDigest: protocolDigest,
    reasoningEffort: 'low',
    retentionPolicy: 'CONTROLLED' as const,
    serviceTier: null,
    secretEnvironmentNames: Object.freeze([]),
    terminalTimeoutMilliseconds: 1_000,
    thread: Object.freeze({ kind: ExternalThreadPolicy.FRESH }),
  });
  const phaseAuthorities = Object.freeze(
    [WorkflowPhase.DISCOVERY, WorkflowPhase.IMPLEMENT, WorkflowPhase.PLAN].map((phase) =>
      Object.freeze({
        phase,
        permissionProfileId: 'codeclosure-m2-5-1-worker-fixture',
        permissionProfileDigest: permissionDigest,
        executionConfigDigest,
        instructionSourceManifestId: 'codeclosure-m2-5-1-fixture-instructions',
        instructionSources,
        allowedRoots: Object.freeze([
          phase === WorkflowPhase.IMPLEMENT
            ? input.candidateWorkspaceRoot
            : input.projectReadWorkspaceRoot,
        ]),
        forbiddenRoots: Object.freeze([...input.phaseForbiddenRoots[phase]].toSorted()),
      }),
    ),
  );
  const directives: CodexWorkerDirectiveV3[] = [];
  const phaseRuns: string[] = [];
  let prepareCount = 0;
  let releaseCount = 0;

  const activation: M251ProductionActivation = Object.freeze({
    kind: 'EXPLICIT_PROTOCOL_FIXTURE',
    capabilityRecord,
    operationRoots: Object.freeze([...input.operationRoots].toSorted()),
    phaseAuthorities,
    sharedProfile,
    createExternalWorker: ({
      authority,
      clock,
      expectedExternalProfile,
      forbiddenRoots,
      workspace,
    }: M251ExternalWorkerFactoryInput) =>
      Object.freeze({
        prepare: ({ request, profile, thread }): PreparedExternalWorkerInvocation => {
          prepareCount += 1;
          if (
            thread.kind !== ExternalThreadPolicy.FRESH ||
            profile.schemaVersion !== 3 ||
            canonical(profile) !== canonical(expectedExternalProfile)
          ) {
            throw new TypeError('Protocol fixture received a substituted Profile');
          }
          const selectedPhase = profile.phaseDispatch.find(
            ({ phase }) => phase === request.contextPackage.phase,
          );
          if (selectedPhase === undefined) {
            throw new TypeError('Protocol fixture has no selected phase entry');
          }
          let lease: ReturnType<typeof decodeCandidateWorkspaceLease> | undefined;
          if (request.contextPackage.phase === WorkflowPhase.IMPLEMENT) {
            const owner = authority.getGoalWithWorkflow(request.contextPackage.goalId);
            const candidate = authority.getCandidateAuthorityForWorkflow(
              request.contextPackage.workflowId,
            );
            if (
              owner === undefined ||
              candidate === undefined ||
              owner.workflow.runStatus !== RunStatus.RUNNING ||
              owner.workflow.phase !== WorkflowPhase.IMPLEMENT ||
              candidate.generation.state !== CandidateGenerationState.MUTABLE
            ) {
              throw new TypeError('Protocol fixture Candidate authority is unavailable');
            }
            lease = decodeCandidateWorkspaceLease(
              workspace.issueLease({
                schemaVersion: 1,
                id: `fixture-worker:${request.attemptId}`,
                version: 1,
                issuedAt: clock.now(),
                accessMode: CandidateWorkspaceAccessMode.MUTABLE,
                goalId: owner.goal.id,
                goalRevision: owner.goal.revision,
                workflowId: owner.workflow.id,
                workflowVersion: owner.workflow.version,
                generation: candidate.generation,
                allowedPaths: owner.goal.scope.allowedPaths,
                forbiddenRoots,
              }),
            );
          }
          let released = false;
          return Object.freeze({
            ...(lease === undefined
              ? {}
              : {
                  candidateWorkspaceLeaseId: lease.id,
                  candidateWorkspaceLeaseDigest: lease.leaseDigest,
                  candidateWorkspaceCwdIdentity: lease.root,
                }),
            createWorker: ({
              intent,
              projectReadAuthority,
              onLifecycleEvent,
            }: Parameters<
              PreparedExternalWorkerInvocation['createWorker']
            >[0]): ExternalObservedWorkerPort => {
              if (intent.schemaVersion !== 2) {
                throw new TypeError('Protocol fixture requires the additive v2 execution Intent');
              }
              let sourceAuthority: CodexWorkerSourceAuthorityV1;
              if (request.contextPackage.phase === WorkflowPhase.IMPLEMENT) {
                if (lease === undefined || projectReadAuthority !== undefined) {
                  throw new TypeError('Protocol fixture IMPLEMENT source is inconsistent');
                }
                sourceAuthority = Object.freeze({
                  kind: ExternalPhaseSourceAuthorityKind.CANDIDATE,
                  workspaceLease: decodeCodexCandidateWorkspaceLease(lease),
                });
              } else {
                if (lease !== undefined || projectReadAuthority === undefined) {
                  throw new TypeError('Protocol fixture ProjectRead source is inconsistent');
                }
                sourceAuthority = Object.freeze({
                  kind: ExternalPhaseSourceAuthorityKind.PROJECT_READ,
                  authorityRecord: projectReadAuthority,
                });
              }
              const directive = createCodexWorkerDirectiveV3({
                schemaVersion: 3,
                externalExecutionIntentDigest: intent.intentDigest,
                phaseDispatchEntryDigest: intent.phaseDispatchEntryDigest,
                processLaunchNonce: intent.processLaunchNonce,
                profile: Object.freeze({
                  phase: Object.freeze({ ...selectedPhase }) as CodexWorkerPhaseDirectiveV1,
                  shared: sharedProfile,
                }),
                request: requestBinding(request),
                sourceAuthority,
              });
              directives.push(directive);
              let observation: unknown;
              return Object.freeze({
                async *run(workerRequest: WorkerRequest): AsyncIterable<unknown> {
                  await Promise.resolve();
                  const processIdentityWithoutDigest = Object.freeze({
                    schemaVersion: 1 as const,
                    launchNonce: intent.processLaunchNonce,
                    processId: 25_104,
                    processGroupId: 25_104,
                    processGroupKind: 'POSIX_PROCESS_GROUP' as const,
                    processStartIdentity: `m251-b4:${intent.id}`,
                    executableIdentityDigest: intent.binaryIdentityDigest,
                    controlledStateRootIdentity: intent.controlledStateRootIdentity,
                  });
                  const processIdentity = Object.freeze({
                    ...processIdentityWithoutDigest,
                    identityDigest: digests.digest(
                      externalProcessIdentityProjection(processIdentityWithoutDigest),
                    ),
                  });
                  onLifecycleEvent({
                    schemaVersion: 1,
                    kind: 'PROCESS_STARTED',
                    externalExecutionIntentDigest: intent.intentDigest,
                    requestAttemptId: intent.attemptId,
                    requestWorkerSessionId: intent.workerSessionId,
                    processIdentity,
                  });
                  const backendSessionRef = `fixture-session:${intent.id}`;
                  const backendOperationRef = `fixture-operation:${intent.id}`;
                  onLifecycleEvent({
                    schemaVersion: 1,
                    kind: 'SESSION_STARTED',
                    externalExecutionIntentDigest: intent.intentDigest,
                    requestAttemptId: intent.attemptId,
                    requestWorkerSessionId: intent.workerSessionId,
                    backendSessionRef,
                  });
                  onLifecycleEvent({
                    schemaVersion: 1,
                    kind: 'OPERATION_STARTED',
                    externalExecutionIntentDigest: intent.intentDigest,
                    requestAttemptId: intent.attemptId,
                    requestWorkerSessionId: intent.workerSessionId,
                    backendSessionRef,
                    backendOperationRef,
                    compactionCount: 0,
                  });
                  if (lease !== undefined) {
                    writeFileSync(
                      `${lease.root}/src/payment.js`,
                      input.implementationResult === 'VERIFICATION_REJECTED'
                        ? rejectedPaymentSource()
                        : correctedPaymentSource(),
                    );
                    if (input.implementationResult === 'CONTAINMENT_FAILURE') {
                      writeFileSync(
                        `${lease.root}/src/outside.js`,
                        'export const outsideGoalScope = true;\n',
                      );
                    }
                  }
                  const event = eventFor(workerRequest);
                  phaseRuns.push(workerRequest.contextPackage.phase);
                  yield event;
                  onLifecycleEvent({
                    schemaVersion: 1,
                    kind: 'TERMINAL',
                    externalExecutionIntentDigest: intent.intentDigest,
                    requestAttemptId: intent.attemptId,
                    requestWorkerSessionId: intent.workerSessionId,
                    state: 'COMPLETED',
                    processLaunchCount: 1,
                    backendSessionRef,
                    backendOperationRef,
                    compactionCount: 0,
                    turnInterruptCount: 0,
                    resultEventId: event.id,
                  });
                  observation = Object.freeze({
                    schemaVersion: 1,
                    externalExecutionIntentDigest: intent.intentDigest,
                    requestAttemptId: intent.attemptId,
                    requestWorkerSessionId: intent.workerSessionId,
                    state: 'COMPLETED',
                    processLaunchCount: 1,
                    backendSessionRef,
                    backendOperationRef,
                    compactionCount: 0,
                    turnInterruptCount: 0,
                    resultEventId: event.id,
                  });
                },
                observation: () => observation,
              });
            },
            release: () => {
              if (!released) {
                if (lease !== undefined) {
                  workspace.releaseLease(lease);
                }
                released = true;
                releaseCount += 1;
              }
            },
          });
        },
      } satisfies ExternalWorkerInvocationPort),
  });
  return Object.freeze({
    activation,
    observation: () =>
      Object.freeze({
        directives: Object.freeze([...directives]),
        phaseRuns: Object.freeze([...phaseRuns]),
        prepareCount,
        releaseCount,
      }),
  });
}

function canonical(value: ExternalExecutionProfileDefinitionV3): string {
  return canonicalizeJson(value);
}
