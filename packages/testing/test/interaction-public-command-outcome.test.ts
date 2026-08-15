import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IntakeAnswerDisposition,
  IntakeCommandDisposition,
  IntakeMaterializationDisposition,
  IntakeStartDisposition,
  IntentAdmissionOutcome,
  IntentAdmissionReasonCode,
  InteractionActionOutcomeDisposition,
  InteractionPublicCapability,
  RunStatus,
  WorkflowPhase,
  commandId,
  decodeIntakeCommandOutcome,
  goalId,
  intakeCommandOutcomeProjection,
  intakeCommandResultProjection,
  intakeFailureRecordId,
  intakeRunId,
  intakeRunVersion,
  intentAdmissionDecisionId,
  isoTimestamp,
  sha256Digest,
  workflowId,
  workflowVersion,
  type IntakeCommandOutcome,
  type IntakeCommandResult,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  RuntimeErrorCode,
  StoredCommandDisposition,
  mapRetainedInteractionPublicCommandOutcome,
  storedCommandOutcomeToJson,
  type StoredCommandOutcomeEnvelope,
} from '@codeclosure/runtime';

const digests = new CanonicalJsonSha256DigestProvider();
const NOW = isoTimestamp('2026-08-15T02:00:00.000Z');
const COMMAND = commandId('command_interaction-public-outcome');
const INPUT_DIGEST = digests.digest({ input: 'interaction-public-outcome' });
const RESERVATION_DIGEST = digests.digest({ reservation: 'interaction-public-outcome' });
const RUN_ID = intakeRunId('intake_public-outcome');
const RUN_VERSION = intakeRunVersion(2);

function intakeOutcome(disposition: IntakeCommandDisposition): IntakeCommandOutcome {
  const result: IntakeCommandResult =
    disposition === IntakeCommandDisposition.APPLIED
      ? {
          schemaVersion: 1,
          kind: 'NO_EXECUTION',
          intakeRunId: RUN_ID,
          intakeRunVersion: RUN_VERSION,
          decisionRef: {
            id: intentAdmissionDecisionId('intent-admission_public-outcome'),
            digest: digests.digest({ decision: 'public-outcome' }),
            outcome: IntentAdmissionOutcome.NO_EXECUTION,
            reasonCode: IntentAdmissionReasonCode.ABANDONED,
          },
          answerDisposition: IntakeAnswerDisposition.NOT_REQUESTED,
          materializationDisposition: IntakeMaterializationDisposition.NO_GOAL,
          startDisposition: IntakeStartDisposition.NOT_AUTHORIZED,
        }
      : disposition === IntakeCommandDisposition.REJECTED
        ? {
            schemaVersion: 1,
            kind: 'REJECTED',
            intakeRunId: RUN_ID,
            observedIntakeRunVersion: RUN_VERSION,
            detailCode: 'STALE_OR_INELIGIBLE',
          }
        : {
            schemaVersion: 1,
            kind: 'FAILED',
            intakeRunId: RUN_ID,
            intakeRunVersion: RUN_VERSION,
            failureRef: {
              id: intakeFailureRecordId('intake-failure_public-outcome'),
              digest: digests.digest({ failure: 'public-outcome' }),
            },
          };
  const base = {
    schemaVersion: 1 as const,
    disposition,
    commandId: COMMAND,
    intakeRunId: RUN_ID,
    canonicalCommandInputDigest: INPUT_DIGEST,
    reservationDigest: RESERVATION_DIGEST,
    observedIntakeRunVersion: RUN_VERSION,
    result,
    resultDigest: digests.digest(intakeCommandResultProjection(result)),
    completedAt: NOW,
  };
  return decodeIntakeCommandOutcome(
    {
      ...base,
      outcomeDigest: digests.digest(intakeCommandOutcomeProjection(base)),
    },
    digests,
  );
}

function goalOutcome(disposition: StoredCommandDisposition): StoredCommandOutcomeEnvelope {
  const workflow = {
    id: workflowId('workflow_interaction-public-outcome'),
    version: workflowVersion(3),
    phase: WorkflowPhase.DISCOVERY,
    runStatus: RunStatus.RUNNING,
  };
  const common = {
    schemaVersion: 3 as const,
    disposition,
    target: {
      aggregateType: 'GOAL' as const,
      aggregateId: goalId('goal_interaction-public-outcome'),
    },
    goalId: goalId('goal_interaction-public-outcome'),
    workflow,
  };
  return disposition === StoredCommandDisposition.APPLIED
    ? {
        ...common,
        disposition,
        output: {
          schemaVersion: 1,
          commandId: COMMAND,
          ok: true,
          goalId: common.goalId,
          workflowVersion: workflow.version,
          phase: workflow.phase,
          runStatus: workflow.runStatus,
        },
      }
    : {
        ...common,
        disposition,
        output: {
          schemaVersion: 1,
          commandId: COMMAND,
          ok: false,
          error: {
            code: RuntimeErrorCode.DOMAIN_REJECTED,
            message: 'The retained command was rejected.',
            retryable: false,
            detailCode: 'GOAL_NOT_STARTABLE',
          },
        },
      };
}

void test('maps every retained Intake disposition without consulting nested result fields', () => {
  for (const disposition of Object.values(IntakeCommandDisposition)) {
    const outcome = intakeOutcome(disposition);
    assert.deepEqual(
      mapRetainedInteractionPublicCommandOutcome(
        { publicCapability: InteractionPublicCapability.SUBMIT_INTAKE, outcome },
        digests,
      ),
      {
        commandId: COMMAND,
        canonicalCommandInputDigest: INPUT_DIGEST,
        disposition,
        publicCommandOutcomeDigest: outcome.outcomeDigest,
        resultProjectionDigest: outcome.resultDigest,
        completedAt: NOW,
      },
    );
  }
});

void test('maps all Goal-control capabilities from the retained envelope top-level disposition', () => {
  for (const publicCapability of [
    InteractionPublicCapability.START_GOAL,
    InteractionPublicCapability.RESUME_GOAL,
    InteractionPublicCapability.CANCEL_GOAL,
  ] as const) {
    for (const disposition of Object.values(StoredCommandDisposition)) {
      const outcome = goalOutcome(disposition);
      assert.deepEqual(
        mapRetainedInteractionPublicCommandOutcome(
          {
            publicCapability,
            canonicalCommandInputDigest: INPUT_DIGEST,
            completedAt: NOW,
            outcome,
          },
          digests,
        ),
        {
          commandId: COMMAND,
          canonicalCommandInputDigest: INPUT_DIGEST,
          disposition:
            disposition === StoredCommandDisposition.APPLIED
              ? InteractionActionOutcomeDisposition.APPLIED
              : InteractionActionOutcomeDisposition.REJECTED,
          publicCommandOutcomeDigest: digests.digest(storedCommandOutcomeToJson(outcome)),
          resultProjectionDigest: digests.digest(outcome.output),
          completedAt: NOW,
        },
      );
    }
  }
});

void test('rejects caller wrappers, nested dispositions, mismatched members, and unknown shapes', () => {
  const retained = goalOutcome(StoredCommandDisposition.APPLIED);
  for (const forged of [
    { status: 'APPLIED', output: retained.output },
    { drive: { status: 'APPLIED' }, output: retained.output },
    { publicCapability: InteractionPublicCapability.START_GOAL, outcome: retained },
    {
      publicCapability: InteractionPublicCapability.SUBMIT_INTAKE,
      outcome: intakeOutcome(IntakeCommandDisposition.APPLIED),
      disposition: 'FAILED',
    },
    { publicCapability: 'LIST_GOALS', outcome: retained },
  ]) {
    assert.throws(() => mapRetainedInteractionPublicCommandOutcome(forged, digests));
  }
  assert.throws(() =>
    mapRetainedInteractionPublicCommandOutcome(
      {
        publicCapability: InteractionPublicCapability.START_GOAL,
        canonicalCommandInputDigest: sha256Digest(`sha256:${'0'.repeat(64)}`),
        completedAt: NOW,
        outcome: { ...retained, disposition: 'FAILED' },
      },
      digests,
    ),
  );
});
