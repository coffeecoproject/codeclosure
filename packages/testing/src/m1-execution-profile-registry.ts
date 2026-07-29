import { executionProfileId, type ExecutionProfileDefinition } from '@codeclosure/domain';

import {
  FakeCandidateSourceFixture,
  type FakeCandidateSourceFixture as FakeCandidateSourceFixtureType,
} from './fake-candidate-source.js';
import {
  FakeVerificationFixture,
  type FakeVerificationFixture as FakeVerificationFixtureType,
} from './fake-verification-runner.js';
import {
  FakeWorkerFixture,
  type FakeWorkerFixture as FakeWorkerFixtureType,
} from './fake-worker.js';

export const M1FakeExecutionProfileName = {
  HAPPY_PATH: 'happy-path',
  LYING_WORKER: 'lying-worker',
  MISSING_EVIDENCE: 'missing-evidence',
  FAILING_EVIDENCE: 'failing-evidence',
  STALE_CLOSEOUT: 'stale-closeout',
  RESTART_RESUME: 'restart-resume',
  DUPLICATE_RESULT: 'duplicate-result',
  CANDIDATE_DRIFT: 'candidate-drift',
} as const;
export type M1FakeExecutionProfileName =
  (typeof M1FakeExecutionProfileName)[keyof typeof M1FakeExecutionProfileName];

export interface M1FakeExecutionProfileRecipe {
  readonly name: M1FakeExecutionProfileName;
  readonly definition: ExecutionProfileDefinition;
  readonly workerFixture: FakeWorkerFixtureType;
  readonly candidateSourceFixture: FakeCandidateSourceFixtureType;
  readonly verificationFixture: FakeVerificationFixtureType;
}

const PROFILE_VERSION = 'codeclosure-m1-fake-profile-v1';
const ADAPTER_VERSION = 'v1';
const DRIVER_VERSION = 'm1-deterministic-driver-v1';

interface M1FakeExecutionProfileIdentity {
  readonly id?: string;
  readonly profileVersion?: string;
  readonly candidateSourceVersion?: string;
}

function recipe(
  name: M1FakeExecutionProfileName,
  workerFixture: FakeWorkerFixtureType,
  candidateSourceFixture: FakeCandidateSourceFixtureType,
  verificationFixture: FakeVerificationFixtureType,
  identity: M1FakeExecutionProfileIdentity = Object.freeze({}),
): M1FakeExecutionProfileRecipe {
  return Object.freeze({
    name,
    definition: Object.freeze({
      id: executionProfileId(identity.id ?? `profile_m1-${name}`),
      schemaVersion: 1,
      version: identity.profileVersion ?? PROFILE_VERSION,
      workerAdapter: `fake-worker:${workerFixture}`,
      workerAdapterVersion: ADAPTER_VERSION,
      candidateSource: `fake-candidate-source:${candidateSourceFixture}`,
      candidateSourceVersion: identity.candidateSourceVersion ?? ADAPTER_VERSION,
      verificationRunner: `fake-verification-runner:${verificationFixture}`,
      verificationRunnerVersion: ADAPTER_VERSION,
      driverVersion: DRIVER_VERSION,
    }),
    workerFixture,
    candidateSourceFixture,
    verificationFixture,
  });
}

const m1Profiles: readonly M1FakeExecutionProfileRecipe[] = Object.freeze([
  recipe(
    M1FakeExecutionProfileName.HAPPY_PATH,
    FakeWorkerFixture.VALID_RESULT,
    FakeCandidateSourceFixture.STABLE,
    FakeVerificationFixture.PASS,
  ),
  recipe(
    M1FakeExecutionProfileName.LYING_WORKER,
    FakeWorkerFixture.FABRICATED_ACCEPT,
    FakeCandidateSourceFixture.STABLE,
    FakeVerificationFixture.PASS,
  ),
  recipe(
    M1FakeExecutionProfileName.MISSING_EVIDENCE,
    FakeWorkerFixture.VALID_RESULT,
    FakeCandidateSourceFixture.STABLE,
    FakeVerificationFixture.MALFORMED,
  ),
  recipe(
    M1FakeExecutionProfileName.FAILING_EVIDENCE,
    FakeWorkerFixture.VALID_RESULT,
    FakeCandidateSourceFixture.STABLE,
    FakeVerificationFixture.FAIL,
  ),
  recipe(
    M1FakeExecutionProfileName.STALE_CLOSEOUT,
    FakeWorkerFixture.VALID_RESULT,
    FakeCandidateSourceFixture.CONTROLLED_FROZEN_DRIFT,
    FakeVerificationFixture.PASS,
    Object.freeze({
      id: 'profile_m1-stale-closeout-v2',
      profileVersion: 'codeclosure-m1-fake-profile-v2',
      candidateSourceVersion: 'controlled-frozen-drift-v1',
    }),
  ),
  recipe(
    M1FakeExecutionProfileName.RESTART_RESUME,
    FakeWorkerFixture.INITIAL_DISPATCH_DELAY,
    FakeCandidateSourceFixture.STABLE,
    FakeVerificationFixture.PASS,
    Object.freeze({
      id: 'profile_m1-restart-resume-v2',
      profileVersion: 'codeclosure-m1-fake-profile-v2',
    }),
  ),
  recipe(
    M1FakeExecutionProfileName.DUPLICATE_RESULT,
    FakeWorkerFixture.DUPLICATE_RESULT,
    FakeCandidateSourceFixture.STABLE,
    FakeVerificationFixture.PASS,
  ),
  recipe(
    M1FakeExecutionProfileName.CANDIDATE_DRIFT,
    FakeWorkerFixture.VALID_RESULT,
    FakeCandidateSourceFixture.FREEZE_DRIFT,
    FakeVerificationFixture.PASS,
  ),
]);

export function m1FakeExecutionProfileRecipes(): readonly M1FakeExecutionProfileRecipe[] {
  return m1Profiles;
}

export function m1FakeExecutionProfileRecipe(name: string): M1FakeExecutionProfileRecipe {
  const selected = m1Profiles.find((profile) => profile.name === name);
  if (selected === undefined) {
    throw new TypeError(`Unknown M1 Fake execution profile: ${name}`);
  }
  return selected;
}
