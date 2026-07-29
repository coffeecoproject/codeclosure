import type { GoalAuditView, GoalStatusView } from '@codeclosure/runtime';

import { requireM1ProofAudit, requireM1ProofStatus } from './m1-demo-proof-helpers.js';
import { createCliComposition, type CreateCliCompositionOptions } from './trusted-composition.js';

/**
 * Proof-only projection of Runtime-owned read views. These snapshots explain
 * retained authority; they cannot mutate Workflow state or issue Acceptance.
 */
export interface M1ProofReadFacade {
  readonly status: GoalStatusView;
  readonly audit: GoalAuditView;
  close(): void;
}

/**
 * Opens proof reads only after a public CLI invocation has already performed
 * and asserted any required startup recovery. Trusted composition still runs
 * its normal lifecycle, but a non-empty recovery summary fails closed so this
 * read cannot hide that it was the operation which reconciled retained work.
 */
export function createM1ProofReadFacade(
  options: CreateCliCompositionOptions,
  goalId: GoalStatusView['goalId'],
): M1ProofReadFacade {
  const composition = createCliComposition(options);
  try {
    if (
      composition.startupRecovery.scannedCount !== 0 ||
      composition.startupRecovery.reconciledCount !== 0 ||
      composition.startupRecovery.recoveryIds.length !== 0
    ) {
      throw new TypeError(
        'M1 proof read cannot perform or conceal startup recovery; use the public CLI first',
      );
    }
    const status = requireM1ProofStatus(composition.application, goalId);
    const audit = requireM1ProofAudit(composition.application, goalId);
    return Object.freeze({
      status,
      audit,
      close: (): void => composition.close(),
    });
  } catch (error) {
    composition.close();
    throw error;
  }
}
