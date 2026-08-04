import { Buffer } from 'node:buffer';

import type {
  AnswerOnlyAssistantResponseV1,
  IntentAnalysisAssistantResponseV1,
} from './intake-assistant.js';

export const M25IntakeRetentionRejectionReason = {
  ILL_FORMED_UNICODE: 'ILL_FORMED_UNICODE',
  PROHIBITED_CONTROL_CHARACTER: 'PROHIBITED_CONTROL_CHARACTER',
  PRIVATE_KEY_MARKER: 'PRIVATE_KEY_MARKER',
  SENSITIVE_FIELD_MARKER: 'SENSITIVE_FIELD_MARKER',
} as const;
export type M25IntakeRetentionRejectionReason =
  (typeof M25IntakeRetentionRejectionReason)[keyof typeof M25IntakeRetentionRejectionReason];

export type M25IntakeRetentionClassification =
  | Readonly<{ accepted: true; observedByteCount: number }>
  | Readonly<{
      accepted: false;
      reasonCode: M25IntakeRetentionRejectionReason;
      observedByteCount: number;
    }>;

const privateKeyLabels = new Set([
  'PRIVATE KEY',
  'ENCRYPTED PRIVATE KEY',
  'RSA PRIVATE KEY',
  'DSA PRIVATE KEY',
  'EC PRIVATE KEY',
  'OPENSSH PRIVATE KEY',
  'PGP PRIVATE KEY BLOCK',
]);

const sensitiveFieldNames = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'password',
  'passwd',
  'secret',
  'client_secret',
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'private_key',
]);

function trimAsciiSpaceAndTab(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && (value[start] === ' ' || value[start] === '\t')) {
    start += 1;
  }
  while (end > start && (value[end - 1] === ' ' || value[end - 1] === '\t')) {
    end -= 1;
  }
  return value.slice(start, end);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function isProhibitedControl(codePoint: number): boolean {
  return (
    (codePoint >= 0x00 &&
      codePoint <= 0x1f &&
      codePoint !== 0x09 &&
      codePoint !== 0x0a &&
      codePoint !== 0x0d) ||
    (codePoint >= 0x7f && codePoint <= 0x9f)
  );
}

function isPrivateKeyMarker(line: string): boolean {
  for (const boundary of ['BEGIN ', 'END '] as const) {
    const prefix = `-----${boundary}`;
    if (line.startsWith(prefix) && line.endsWith('-----')) {
      return privateKeyLabels.has(line.slice(prefix.length, -5));
    }
  }
  return false;
}

function isSensitiveFieldMarker(line: string): boolean {
  let markerEnd = 0;
  while (markerEnd < line.length) {
    const code = line.charCodeAt(markerEnd);
    const isAsciiMarker =
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      code === 0x2d ||
      code === 0x5f;
    if (!isAsciiMarker) {
      break;
    }
    markerEnd += 1;
  }
  const marker = line.slice(0, markerEnd).toLowerCase();
  if (!sensitiveFieldNames.has(marker)) {
    return false;
  }
  let delimiter = markerEnd;
  while (line[delimiter] === ' ' || line[delimiter] === '\t') {
    delimiter += 1;
  }
  return line[delimiter] === ':' || line[delimiter] === '=';
}

/**
 * Applies the exact syntactic M2.5 local retention grammar. It never returns
 * the inspected value or a content digest.
 */
export function classifyM25IntakeRetainedText(value: string): M25IntakeRetentionClassification {
  const observedByteCount = Buffer.byteLength(value, 'utf8');
  if (hasUnpairedSurrogate(value)) {
    return {
      accepted: false,
      reasonCode: M25IntakeRetentionRejectionReason.ILL_FORMED_UNICODE,
      observedByteCount,
    };
  }
  for (const character of value) {
    if (isProhibitedControl(character.codePointAt(0) ?? 0)) {
      return {
        accepted: false,
        reasonCode: M25IntakeRetentionRejectionReason.PROHIBITED_CONTROL_CHARACTER,
        observedByteCount,
      };
    }
  }
  for (const rawLine of value.split(/\r\n|\r|\n/)) {
    const line = trimAsciiSpaceAndTab(rawLine);
    if (isPrivateKeyMarker(line)) {
      return {
        accepted: false,
        reasonCode: M25IntakeRetentionRejectionReason.PRIVATE_KEY_MARKER,
        observedByteCount,
      };
    }
    if (isSensitiveFieldMarker(line)) {
      return {
        accepted: false,
        reasonCode: M25IntakeRetentionRejectionReason.SENSITIVE_FIELD_MARKER,
        observedByteCount,
      };
    }
  }
  return { accepted: true, observedByteCount };
}

export function firstRejectedM25IntentAnalysisString(
  response: IntentAnalysisAssistantResponseV1,
): Exclude<M25IntakeRetentionClassification, { accepted: true }> | undefined {
  const strings = [
    ...(response.proposedObjective === undefined ? [] : [response.proposedObjective]),
    ...response.proposedCriteria,
    ...(response.proposedScope === undefined ? [] : [response.proposedScope]),
    ...response.proposedNonGoals,
    ...response.proposedAssumptions,
    ...response.proposedQuestions,
    ...(response.proposedClassification === undefined ? [] : [response.proposedClassification]),
  ];
  for (const value of strings) {
    const classification = classifyM25IntakeRetainedText(value);
    if (!classification.accepted) {
      return classification;
    }
  }
  return undefined;
}

export function rejectedM25AnswerOnlyString(
  response: AnswerOnlyAssistantResponseV1,
): Exclude<M25IntakeRetentionClassification, { accepted: true }> | undefined {
  const classification = classifyM25IntakeRetainedText(response.answerContent);
  return classification.accepted ? undefined : classification;
}
