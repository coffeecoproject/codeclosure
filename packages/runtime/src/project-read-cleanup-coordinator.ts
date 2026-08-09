import {
  auditEventId,
  decodeProjectReadSnapshotCleanupGrant,
  decodeProjectReadSnapshotCleanupOutcome,
  isoTimestamp,
  latestIsoTimestamp,
  projectReadSnapshotCleanupOutcomeId,
  projectReadSnapshotCleanupOutcomeProjection,
  sha256Digest,
  type AuditEventId,
  type ProjectReadSnapshotCleanupGrant,
  type ProjectReadSnapshotCleanupOutcome,
  type ProjectReadSnapshotCleanupOutcomeId,
} from '@codeclosure/domain';
import { z } from 'zod';

import type { Clock, DigestProvider } from './ports.js';
import type { ProjectReadCleanupControlStore } from './project-read-cleanup-store.js';
import {
  ProjectReadSnapshotCleanupRequestDisposition,
  assertProjectReadSnapshotCleanupObservationMatchesGrant,
  assertProjectReadSnapshotCleanupOutcomeClosure,
  decideProjectReadSnapshotCleanupRequest,
  decodeProjectReadSnapshotCleanupObservation,
  type ProjectReadSnapshotCleanupObservation,
} from './project-read-snapshot-cleanup-contracts.js';
import type { ProjectReadWorkspacePort } from './project-read-workspace-port.js';

export const ProjectReadSnapshotCleanupCoordinatorStatus = {
  REJECTED: 'REJECTED',
  UNRESOLVED: 'UNRESOLVED',
  RESOLVED: 'RESOLVED',
} as const;
export type ProjectReadSnapshotCleanupCoordinatorStatus =
  (typeof ProjectReadSnapshotCleanupCoordinatorStatus)[keyof typeof ProjectReadSnapshotCleanupCoordinatorStatus];

export const ProjectReadSnapshotCleanupRejectionReasonCode = {
  INVALID_GRANT: 'INVALID_GRANT',
  MISSING_GRANT: 'MISSING_GRANT',
  GRANT_IDENTITY_CONFLICT: 'GRANT_IDENTITY_CONFLICT',
} as const;
export type ProjectReadSnapshotCleanupRejectionReasonCode =
  (typeof ProjectReadSnapshotCleanupRejectionReasonCode)[keyof typeof ProjectReadSnapshotCleanupRejectionReasonCode];

export const ProjectReadSnapshotCleanupUnresolvedReasonCode = {
  NO_TERMINAL_OBSERVATION: 'NO_TERMINAL_OBSERVATION',
  PORT_INVOCATION_FAILED: 'PORT_INVOCATION_FAILED',
  PORT_OBSERVATION_INVALID: 'PORT_OBSERVATION_INVALID',
  STORE_GRANT_CONFLICT: 'STORE_GRANT_CONFLICT',
  STORE_RESOLUTION_CONFLICT: 'STORE_RESOLUTION_CONFLICT',
} as const;
export type ProjectReadSnapshotCleanupUnresolvedReasonCode =
  (typeof ProjectReadSnapshotCleanupUnresolvedReasonCode)[keyof typeof ProjectReadSnapshotCleanupUnresolvedReasonCode];

export const ProjectReadSnapshotCleanupResolutionKind = {
  APPLIED: 'APPLIED',
  CONCURRENT_REPLAY: 'CONCURRENT_REPLAY',
  RETAINED_REPLAY: 'RETAINED_REPLAY',
} as const;
export type ProjectReadSnapshotCleanupResolutionKind =
  (typeof ProjectReadSnapshotCleanupResolutionKind)[keyof typeof ProjectReadSnapshotCleanupResolutionKind];

export interface ProjectReadSnapshotCleanupCoordinatorRequest {
  /** Untrusted request value. Runtime admits only its exact Store-retained Grant. */
  readonly grant: unknown;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export type ProjectReadSnapshotCleanupCoordinatorResult =
  | Readonly<{
      readonly status: typeof ProjectReadSnapshotCleanupCoordinatorStatus.REJECTED;
      readonly reasonCode: ProjectReadSnapshotCleanupRejectionReasonCode;
      readonly portInvoked: false;
    }>
  | Readonly<{
      readonly status: typeof ProjectReadSnapshotCleanupCoordinatorStatus.UNRESOLVED;
      readonly reasonCode: ProjectReadSnapshotCleanupUnresolvedReasonCode;
      readonly portInvoked: true;
    }>
  | Readonly<{
      readonly status: typeof ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED;
      readonly resolutionKind: typeof ProjectReadSnapshotCleanupResolutionKind.RETAINED_REPLAY;
      readonly portInvoked: false;
      readonly outcome: ProjectReadSnapshotCleanupOutcome;
    }>
  | Readonly<{
      readonly status: typeof ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED;
      readonly resolutionKind:
        | typeof ProjectReadSnapshotCleanupResolutionKind.APPLIED
        | typeof ProjectReadSnapshotCleanupResolutionKind.CONCURRENT_REPLAY;
      readonly portInvoked: true;
      readonly outcome: ProjectReadSnapshotCleanupOutcome;
    }>;

export interface ProjectReadCleanupIdentityGenerator {
  nextProjectReadSnapshotCleanupOutcomeId(): ProjectReadSnapshotCleanupOutcomeId;
  nextAuditEventId(): AuditEventId;
}

export interface ProjectReadSnapshotCleanupCoordinatorDependencies {
  readonly store: ProjectReadCleanupControlStore;
  readonly workspace: Pick<ProjectReadWorkspacePort, 'cleanupSnapshot'>;
  readonly clock: Clock;
  readonly ids: ProjectReadCleanupIdentityGenerator;
  readonly digests: DigestProvider;
}

export interface ProjectReadSnapshotCleanupCoordinator {
  resolve(
    request: ProjectReadSnapshotCleanupCoordinatorRequest,
  ): ProjectReadSnapshotCleanupCoordinatorResult;
}

const nonBlankMessageSchema = z
  .string()
  .max(16_384)
  .refine((value) => value.trim().length > 0);
const storeResolutionResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('APPLIED'), value: z.unknown() }).strict(),
  z.object({ status: z.literal('REPLAYED'), value: z.unknown() }).strict(),
  z.object({ status: z.literal('GRANT_CONFLICT'), message: nonBlankMessageSchema }).strict(),
  z.object({ status: z.literal('RESOLUTION_CONFLICT'), message: nonBlankMessageSchema }).strict(),
]);

function decodeRetainedGrant(
  value: unknown,
  digests: DigestProvider,
): ProjectReadSnapshotCleanupGrant | null {
  return value === undefined ? null : decodeProjectReadSnapshotCleanupGrant(value, digests);
}

function decodeRetainedOutcome(
  value: unknown,
  digests: DigestProvider,
): ProjectReadSnapshotCleanupOutcome | null {
  return value === undefined ? null : decodeProjectReadSnapshotCleanupOutcome(value, digests);
}

function createOutcome(
  grant: ProjectReadSnapshotCleanupGrant,
  observation: ProjectReadSnapshotCleanupObservation,
  dependencies: Pick<
    ProjectReadSnapshotCleanupCoordinatorDependencies,
    'clock' | 'ids' | 'digests'
  >,
): ProjectReadSnapshotCleanupOutcome {
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    id: projectReadSnapshotCleanupOutcomeId(
      dependencies.ids.nextProjectReadSnapshotCleanupOutcomeId(),
    ),
    grantId: grant.id,
    grantDigest: grant.grantDigest,
    cleanupObservationId: observation.id,
    cleanupObservationDigest: observation.observationDigest,
    disposition: observation.disposition,
    resolvedAt: latestIsoTimestamp(isoTimestamp(dependencies.clock.now()), observation.observedAt),
  });
  return decodeProjectReadSnapshotCleanupOutcome(
    {
      ...withoutDigest,
      outcomeDigest: sha256Digest(
        dependencies.digests.digest(projectReadSnapshotCleanupOutcomeProjection(withoutDigest)),
      ),
    },
    dependencies.digests,
  );
}

function assertAppliedOutcomeIsExact(
  retained: ProjectReadSnapshotCleanupOutcome,
  proposed: ProjectReadSnapshotCleanupOutcome,
  observation: ProjectReadSnapshotCleanupObservation,
  grant: ProjectReadSnapshotCleanupGrant,
): void {
  assertProjectReadSnapshotCleanupOutcomeClosure(retained, observation, grant);
  if (retained.id !== proposed.id || retained.outcomeDigest !== proposed.outcomeDigest) {
    throw new TypeError('Cleanup Store changed the Runtime-authored applied Outcome');
  }
}

function assertReplayOutcomeMatchesGrant(
  retained: ProjectReadSnapshotCleanupOutcome,
  grant: ProjectReadSnapshotCleanupGrant,
): void {
  const decision = decideProjectReadSnapshotCleanupRequest(grant, grant, retained);
  if (
    decision.disposition !== ProjectReadSnapshotCleanupRequestDisposition.RETURN_RETAINED_OUTCOME ||
    decision.outcome.outcomeDigest !== retained.outcomeDigest
  ) {
    throw new TypeError('Cleanup Store replay does not bind the exact retained Grant');
  }
}

class RuntimeProjectReadSnapshotCleanupCoordinator implements ProjectReadSnapshotCleanupCoordinator {
  readonly #dependencies: ProjectReadSnapshotCleanupCoordinatorDependencies;

  public constructor(dependencies: ProjectReadSnapshotCleanupCoordinatorDependencies) {
    this.#dependencies = dependencies;
  }

  public resolve(
    request: ProjectReadSnapshotCleanupCoordinatorRequest,
  ): ProjectReadSnapshotCleanupCoordinatorResult {
    let requestedGrant: ProjectReadSnapshotCleanupGrant;
    try {
      requestedGrant = decodeProjectReadSnapshotCleanupGrant(
        request.grant,
        this.#dependencies.digests,
      );
    } catch {
      return Object.freeze({
        status: ProjectReadSnapshotCleanupCoordinatorStatus.REJECTED,
        reasonCode: ProjectReadSnapshotCleanupRejectionReasonCode.INVALID_GRANT,
        portInvoked: false,
      });
    }

    const retainedGrant = decodeRetainedGrant(
      this.#dependencies.store.getProjectReadSnapshotCleanupGrant(requestedGrant.id),
      this.#dependencies.digests,
    );
    const retainedOutcome = decodeRetainedOutcome(
      this.#dependencies.store.getProjectReadSnapshotCleanupOutcome(requestedGrant.id),
      this.#dependencies.digests,
    );
    if (retainedOutcome !== null && retainedGrant === null) {
      throw new TypeError('Cleanup Store returned an Outcome without its owning Grant');
    }
    const decision = decideProjectReadSnapshotCleanupRequest(
      requestedGrant,
      retainedGrant,
      retainedOutcome,
    );
    if (
      decision.disposition === ProjectReadSnapshotCleanupRequestDisposition.REJECTED_MISSING_GRANT
    ) {
      return Object.freeze({
        status: ProjectReadSnapshotCleanupCoordinatorStatus.REJECTED,
        reasonCode: ProjectReadSnapshotCleanupRejectionReasonCode.MISSING_GRANT,
        portInvoked: false,
      });
    }
    if (
      decision.disposition ===
      ProjectReadSnapshotCleanupRequestDisposition.REJECTED_IDENTITY_CONFLICT
    ) {
      return Object.freeze({
        status: ProjectReadSnapshotCleanupCoordinatorStatus.REJECTED,
        reasonCode: ProjectReadSnapshotCleanupRejectionReasonCode.GRANT_IDENTITY_CONFLICT,
        portInvoked: false,
      });
    }
    if (
      decision.disposition === ProjectReadSnapshotCleanupRequestDisposition.RETURN_RETAINED_OUTCOME
    ) {
      return Object.freeze({
        status: ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED,
        resolutionKind: ProjectReadSnapshotCleanupResolutionKind.RETAINED_REPLAY,
        portInvoked: false,
        outcome: decision.outcome,
      });
    }
    if (!('grant' in decision)) {
      throw new TypeError('Cleanup request decision is not executable');
    }
    const grant = decision.grant;

    let rawObservation: unknown;
    try {
      rawObservation = this.#dependencies.workspace.cleanupSnapshot(grant);
    } catch {
      return Object.freeze({
        status: ProjectReadSnapshotCleanupCoordinatorStatus.UNRESOLVED,
        reasonCode: ProjectReadSnapshotCleanupUnresolvedReasonCode.PORT_INVOCATION_FAILED,
        portInvoked: true,
      });
    }
    if (rawObservation === null) {
      return Object.freeze({
        status: ProjectReadSnapshotCleanupCoordinatorStatus.UNRESOLVED,
        reasonCode: ProjectReadSnapshotCleanupUnresolvedReasonCode.NO_TERMINAL_OBSERVATION,
        portInvoked: true,
      });
    }

    let observation: ProjectReadSnapshotCleanupObservation;
    try {
      observation = decodeProjectReadSnapshotCleanupObservation(rawObservation);
      assertProjectReadSnapshotCleanupObservationMatchesGrant(observation, grant);
    } catch {
      return Object.freeze({
        status: ProjectReadSnapshotCleanupCoordinatorStatus.UNRESOLVED,
        reasonCode: ProjectReadSnapshotCleanupUnresolvedReasonCode.PORT_OBSERVATION_INVALID,
        portInvoked: true,
      });
    }

    const proposedOutcome = createOutcome(grant, observation, this.#dependencies);
    const rawStoreResult: unknown = this.#dependencies.store.resolveProjectReadSnapshotCleanupGrant(
      {
        grantId: grant.id,
        grantDigest: grant.grantDigest,
        observation,
        outcome: proposedOutcome,
        observationAuditEventId: auditEventId(this.#dependencies.ids.nextAuditEventId()),
        outcomeAuditEventId: auditEventId(this.#dependencies.ids.nextAuditEventId()),
        ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
        ...(request.causationId === undefined ? {} : { causationId: request.causationId }),
      },
    );
    const storeResult = storeResolutionResultSchema.parse(rawStoreResult);
    if (storeResult.status === 'GRANT_CONFLICT') {
      return Object.freeze({
        status: ProjectReadSnapshotCleanupCoordinatorStatus.UNRESOLVED,
        reasonCode: ProjectReadSnapshotCleanupUnresolvedReasonCode.STORE_GRANT_CONFLICT,
        portInvoked: true,
      });
    }
    if (storeResult.status === 'RESOLUTION_CONFLICT') {
      return Object.freeze({
        status: ProjectReadSnapshotCleanupCoordinatorStatus.UNRESOLVED,
        reasonCode: ProjectReadSnapshotCleanupUnresolvedReasonCode.STORE_RESOLUTION_CONFLICT,
        portInvoked: true,
      });
    }

    const outcome = decodeProjectReadSnapshotCleanupOutcome(
      storeResult.value,
      this.#dependencies.digests,
    );
    if (storeResult.status === 'APPLIED') {
      assertAppliedOutcomeIsExact(outcome, proposedOutcome, observation, grant);
      return Object.freeze({
        status: ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED,
        resolutionKind: ProjectReadSnapshotCleanupResolutionKind.APPLIED,
        portInvoked: true,
        outcome,
      });
    }
    assertReplayOutcomeMatchesGrant(outcome, grant);
    return Object.freeze({
      status: ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED,
      resolutionKind: ProjectReadSnapshotCleanupResolutionKind.CONCURRENT_REPLAY,
      portInvoked: true,
      outcome,
    });
  }
}

export function createProjectReadSnapshotCleanupCoordinator(
  dependencies: ProjectReadSnapshotCleanupCoordinatorDependencies,
): ProjectReadSnapshotCleanupCoordinator {
  return new RuntimeProjectReadSnapshotCleanupCoordinator(dependencies);
}
