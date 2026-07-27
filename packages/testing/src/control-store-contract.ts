import assert from 'node:assert/strict';

import {
  decodeGoalSnapshot,
  decodeWorkflowSnapshot,
  deriveGoalStatus,
  isoTimestamp,
  sha256Digest,
  type CommandId,
  type GoalId,
  type Sha256Digest,
  type WorkflowId,
} from '@codeclosure/domain';
import {
  StoredCommandDisposition,
  assertStoredCommandOutcomeBinding,
  decodeJsonValue,
  decodeStoredCommandOutcome,
  type CommandTarget,
  type StoreCommandResult,
  type WorkflowControlStore,
} from '@codeclosure/runtime';

export interface WorkflowControlStoreContractCase {
  readonly store: WorkflowControlStore;
  readonly goalId: GoalId;
  readonly workflowId: WorkflowId;
  readonly commandId: CommandId;
  readonly invalidCommandId: CommandId;
  readonly inputDigest: Sha256Digest;
  readonly target: CommandTarget;
  apply(): StoreCommandResult<unknown>;
  conflict(): StoreCommandResult<unknown>;
  invalid(): unknown;
}

/**
 * One observable contract shared by every M1 WorkflowControlStore adapter.
 * Adapter-specific transaction and restart tests remain additional checks.
 */
export function assertWorkflowControlStoreContract(
  contract: WorkflowControlStoreContractCase,
): void {
  const initialPair = contract.store.getGoalWithWorkflow(contract.goalId);
  assert.notEqual(initialPair, undefined);
  if (initialPair === undefined) {
    return;
  }
  const initialGoal = decodeGoalSnapshot(initialPair.goal);
  const initialWorkflow = decodeWorkflowSnapshot(initialPair.workflow);
  assert.equal(initialGoal.id, contract.goalId);
  assert.equal(initialWorkflow.id, contract.workflowId);
  assert.equal(initialWorkflow.goalId, initialGoal.id);
  assert.equal(initialWorkflow.goalRevision, initialGoal.revision);
  assert.equal(initialGoal.status, deriveGoalStatus(initialWorkflow.runStatus));
  assert.deepEqual(contract.store.getGoal(contract.goalId), initialGoal);
  assert.deepEqual(contract.store.getWorkflow(contract.workflowId), initialWorkflow);
  assert.deepEqual(contract.store.getWorkflowForGoal(contract.goalId), initialWorkflow);

  const applied = contract.apply();
  assert.equal(applied.status, 'APPLIED');
  const currentPair = contract.store.getGoalWithWorkflow(contract.goalId);
  assert.notEqual(currentPair, undefined);
  if (currentPair === undefined) {
    return;
  }
  const currentGoal = decodeGoalSnapshot(currentPair.goal);
  const currentWorkflow = decodeWorkflowSnapshot(currentPair.workflow);
  const appliedOutcome = decodeStoredCommandOutcome(decodeJsonValue(applied.outcome));
  assertStoredCommandOutcomeBinding(
    appliedOutcome,
    contract.commandId,
    contract.target,
    currentGoal.id,
    currentWorkflow.id,
    StoredCommandDisposition.APPLIED,
  );

  const processed = contract.store.getProcessedCommand(contract.commandId);
  assert.notEqual(processed, undefined);
  if (processed === undefined) {
    return;
  }
  assert.equal(processed.commandId, contract.commandId);
  assert.equal(sha256Digest(processed.inputDigest), contract.inputDigest);
  assert.equal(processed.aggregateType, contract.target.aggregateType);
  assert.equal(processed.aggregateId, contract.target.aggregateId);
  isoTimestamp(processed.completedAt);
  assert.deepEqual(processed.outcome, applied.outcome);

  const replayed = contract.apply();
  assert.equal(replayed.status, 'REPLAYED');
  assert.deepEqual(replayed.outcome, applied.outcome);
  assert.equal(contract.conflict().status, 'COMMAND_CONFLICT');
  assert.throws(() => contract.invalid());
  assert.equal(contract.store.getProcessedCommand(contract.invalidCommandId), undefined);
}
