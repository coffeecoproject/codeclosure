import type { CodeClosureApplication } from '@codeclosure/runtime';

import { CliOperation, type CliGoalAuditEnvelope } from '../cli/contracts.js';
import type { AuditShowInvocation } from '../cli/parser.js';

export function executeAuditShow(
  application: CodeClosureApplication,
  goalId: AuditShowInvocation['goalId'],
): CliGoalAuditEnvelope {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'GOAL_AUDIT',
    operation: CliOperation.AUDIT_SHOW,
    result: application.getGoalAudit(goalId),
  });
}
