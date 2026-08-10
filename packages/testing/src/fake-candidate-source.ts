import { createHash } from 'node:crypto';

import { sha256Digest, type CandidateGenerationId, type Sha256Digest } from '@codeclosure/domain';
import {
  CandidatePreparationDisposition,
  decodeCandidatePreparation,
  decodeCandidatePreparationV2,
  decodeCandidateRepairPreparation,
  validateCandidateFreezeRequest,
  validateCandidatePreparationRequestValue,
  validateCandidateRepairPreparationRequest,
  validateFrozenCandidateIntegrityRequest,
  type CandidateSourcePort,
} from '@codeclosure/runtime';

export const FakeCandidateSourceFixture = {
  STABLE: 'STABLE',
  FREEZE_DRIFT: 'FREEZE_DRIFT',
  FROZEN_DRIFT: 'FROZEN_DRIFT',
  CONTROLLED_FROZEN_DRIFT: 'CONTROLLED_FROZEN_DRIFT',
  MALFORMED: 'MALFORMED',
  THROW: 'THROW',
  FREEZE_SENSITIVE_OUTPUT: 'FREEZE_SENSITIVE_OUTPUT',
  FREEZE_THROW_SENSITIVE: 'FREEZE_THROW_SENSITIVE',
} as const;
export type FakeCandidateSourceFixture =
  (typeof FakeCandidateSourceFixture)[keyof typeof FakeCandidateSourceFixture];

function digest(label: string): Sha256Digest {
  return sha256Digest(`sha256:${createHash('sha256').update(label, 'utf8').digest('hex')}`);
}

export class FakeCandidateSource implements CandidateSourcePort {
  readonly #fixture: FakeCandidateSourceFixture;
  readonly #frozen = new Map<CandidateGenerationId, Sha256Digest>();
  readonly #simulatedDrift = new Set<CandidateGenerationId>();

  public constructor(fixture: FakeCandidateSourceFixture = FakeCandidateSourceFixture.STABLE) {
    this.#fixture = fixture;
  }

  public simulateFrozenDrift(generationId: CandidateGenerationId): void {
    if (this.#fixture !== FakeCandidateSourceFixture.CONTROLLED_FROZEN_DRIFT) {
      throw new TypeError('Fake Candidate Source does not permit controlled frozen drift');
    }
    this.#simulatedDrift.add(generationId);
  }

  public prepare(rawRequest: Parameters<CandidateSourcePort['prepare']>[0]): unknown {
    const request = validateCandidatePreparationRequestValue(rawRequest);
    if (this.#fixture === FakeCandidateSourceFixture.THROW) {
      throw new Error('Fake Candidate Source preparation failed');
    }
    if (this.#fixture === FakeCandidateSourceFixture.MALFORMED) {
      return Object.freeze({ schemaVersion: 1, generationId: request.generationId });
    }
    const baseDigest = digest(
      `base\u0000${request.goalId}\u0000${request.goalRevision}\u0000${request.projectPath}`,
    );
    return request.schemaVersion === 1
      ? decodeCandidatePreparation({
          schemaVersion: 1,
          goalId: request.goalId,
          workflowId: request.workflowId,
          candidateId: request.candidateId,
          generationId: request.generationId,
          baseDigest,
        })
      : decodeCandidatePreparationV2({
          schemaVersion: 2,
          disposition: CandidatePreparationDisposition.PREPARED,
          goalId: request.goalId,
          workflowId: request.workflowId,
          candidateId: request.candidateId,
          generationId: request.generationId,
          planProjectReadAuthorityId: request.planProjectReadAuthorityId,
          planProjectReadAuthorityRecordDigest: request.planProjectReadAuthorityRecordDigest,
          observedSourceTree: request.expectedSourceTree,
          observedGitState: request.expectedGitState,
          baseDigest,
        });
  }

  public prepareRepair(rawRequest: Parameters<CandidateSourcePort['prepareRepair']>[0]): unknown {
    const request = validateCandidateRepairPreparationRequest(rawRequest);
    if (this.#fixture === FakeCandidateSourceFixture.THROW) {
      throw new Error('Fake Candidate Source repair preparation failed');
    }
    if (this.#fixture === FakeCandidateSourceFixture.MALFORMED) {
      return Object.freeze({ schemaVersion: 1, generationId: request.generationId });
    }
    return decodeCandidateRepairPreparation({
      schemaVersion: 1,
      goalId: request.goalId,
      workflowId: request.workflowId,
      candidateId: request.candidateId,
      generationId: request.generationId,
      parentGenerationId: request.parentGenerationId,
      baseDigest: request.expectedBaseDigest,
    });
  }

  public observeFreeze(rawRequest: Parameters<CandidateSourcePort['observeFreeze']>[0]): unknown {
    if (rawRequest.schemaVersion !== 1) {
      throw new TypeError('Fake Candidate Source supports only historical freeze schema version 1');
    }
    const request = validateCandidateFreezeRequest(rawRequest);
    if (this.#fixture === FakeCandidateSourceFixture.THROW) {
      throw new Error('Fake Candidate Source freeze observation failed');
    }
    if (this.#fixture === FakeCandidateSourceFixture.FREEZE_THROW_SENSITIVE) {
      throw new Error('token=demo-sensitive-value');
    }
    if (this.#fixture === FakeCandidateSourceFixture.MALFORMED) {
      return Object.freeze({ schemaVersion: 1, generationId: request.generation.id });
    }
    const first = digest(`frozen\u0000${request.generation.id}\u0000${request.generation.version}`);
    const second =
      this.#fixture === FakeCandidateSourceFixture.FREEZE_DRIFT
        ? digest(`drift\u0000${request.generation.id}`)
        : first;
    if (first === second) {
      this.#frozen.set(request.generation.id, first);
    }
    const observation = {
      schemaVersion: 1,
      generationId: request.generation.id,
      firstSourceDigest: first,
      secondSourceDigest: second,
      changeSetDigest: digest(`change-set\u0000${request.generation.id}`),
    };
    return Object.freeze(
      this.#fixture === FakeCandidateSourceFixture.FREEZE_SENSITIVE_OUTPUT
        ? { ...observation, detail: 'token=demo-sensitive-value' }
        : observation,
    );
  }

  public observeFrozen(rawRequest: Parameters<CandidateSourcePort['observeFrozen']>[0]): unknown {
    const request = validateFrozenCandidateIntegrityRequest(rawRequest);
    if (this.#fixture === FakeCandidateSourceFixture.THROW) {
      throw new Error('Fake Candidate Source integrity observation failed');
    }
    if (this.#fixture === FakeCandidateSourceFixture.MALFORMED) {
      return Object.freeze({ schemaVersion: 1, generationId: request.generation.id });
    }
    const retained = this.#frozen.get(request.generation.id) ?? request.generation.frozenDigest;
    if (retained === undefined) {
      throw new TypeError('Fake Candidate Source has no frozen digest');
    }
    return Object.freeze({
      schemaVersion: 1,
      generationId: request.generation.id,
      observedDigest:
        this.#fixture === FakeCandidateSourceFixture.FROZEN_DRIFT ||
        this.#simulatedDrift.has(request.generation.id)
          ? digest(`post-freeze-drift\u0000${request.generation.id}`)
          : retained,
    });
  }
}
