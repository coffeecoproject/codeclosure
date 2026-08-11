import { AttemptFailureClass } from '@codeclosure/domain';

export const ProjectReadCurrencyFailureReasonCode = {
  PROJECT_SOURCE_DRIFT: 'PROJECT_SOURCE_DRIFT',
  PROJECT_READ_SNAPSHOT_DRIFT: 'PROJECT_READ_SNAPSHOT_DRIFT',
  PROJECT_READ_AUTHORITY_INVALID: 'PROJECT_READ_AUTHORITY_INVALID',
} as const;
export type ProjectReadCurrencyFailureReasonCode =
  (typeof ProjectReadCurrencyFailureReasonCode)[keyof typeof ProjectReadCurrencyFailureReasonCode];

export function projectReadCurrencyFailureClassForReasonCode(
  reasonCode: string,
): AttemptFailureClass | undefined {
  return reasonCode === ProjectReadCurrencyFailureReasonCode.PROJECT_SOURCE_DRIFT ||
    reasonCode === ProjectReadCurrencyFailureReasonCode.PROJECT_READ_SNAPSHOT_DRIFT ||
    reasonCode === ProjectReadCurrencyFailureReasonCode.PROJECT_READ_AUTHORITY_INVALID
    ? AttemptFailureClass.INTEGRITY_VIOLATION
    : undefined;
}
