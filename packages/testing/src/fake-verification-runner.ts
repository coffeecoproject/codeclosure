import { EvidenceResultStatus } from '@codeclosure/domain';
import { decodeVerificationRequest, type VerificationPort } from '@codeclosure/runtime';

export const FakeVerificationFixture = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  RUNNER_ERROR: 'RUNNER_ERROR',
  TIMEOUT: 'TIMEOUT',
  MALFORMED: 'MALFORMED',
  CROSS_PRODUCER: 'CROSS_PRODUCER',
  CROSS_CHECK: 'CROSS_CHECK',
  SENSITIVE_OUTPUT: 'SENSITIVE_OUTPUT',
  THROW: 'THROW',
  THROW_SENSITIVE: 'THROW_SENSITIVE',
} as const;
export type FakeVerificationFixture =
  (typeof FakeVerificationFixture)[keyof typeof FakeVerificationFixture];

export interface FakeVerificationRunnerOptions {
  readonly fixture?: FakeVerificationFixture;
}

export class FakeVerificationRunner implements VerificationPort {
  readonly #fixture: FakeVerificationFixture;

  public constructor(options: FakeVerificationRunnerOptions = {}) {
    this.#fixture = options.fixture ?? FakeVerificationFixture.PASS;
  }

  public run(rawRequest: Parameters<VerificationPort['run']>[0]): unknown {
    decodeVerificationRequest(rawRequest);
    if (this.#fixture === FakeVerificationFixture.THROW) {
      throw new Error('Fake Verification Runner failed');
    }
    if (this.#fixture === FakeVerificationFixture.THROW_SENSITIVE) {
      throw new Error('token=demo-sensitive-value');
    }
    if (this.#fixture === FakeVerificationFixture.MALFORMED) {
      return Object.freeze({ schemaVersion: 1, resultStatus: 'INVALID_RESULT' });
    }
    if (this.#fixture === FakeVerificationFixture.CROSS_PRODUCER) {
      return Object.freeze({
        schemaVersion: 1,
        resultStatus: EvidenceResultStatus.PASS,
        producerIdentity: 'forged-verification-producer',
      });
    }
    if (this.#fixture === FakeVerificationFixture.CROSS_CHECK) {
      return Object.freeze({
        schemaVersion: 1,
        resultStatus: EvidenceResultStatus.PASS,
        checkSpecRef: 'check_forged@v1',
      });
    }
    if (this.#fixture === FakeVerificationFixture.SENSITIVE_OUTPUT) {
      return Object.freeze({
        schemaVersion: 1,
        resultStatus: EvidenceResultStatus.PASS,
        detailCode: 'token=demo-sensitive-value',
      });
    }
    return Object.freeze({
      schemaVersion: 1,
      resultStatus: this.#fixture,
    });
  }
}
