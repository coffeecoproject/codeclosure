import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import {
  M25IntakeRetentionRejectionReason,
  classifyM25IntakeRetainedText,
} from '@codeclosure/runtime';

const privateKeyLabels = [
  'PRIVATE KEY',
  'ENCRYPTED PRIVATE KEY',
  'RSA PRIVATE KEY',
  'DSA PRIVATE KEY',
  'EC PRIVATE KEY',
  'OPENSSH PRIVATE KEY',
  'PGP PRIVATE KEY BLOCK',
] as const;

const sensitiveFields = [
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
] as const;

function rejectionReason(value: string): M25IntakeRetentionRejectionReason {
  const classification = classifyM25IntakeRetainedText(value);
  assert.equal(classification.accepted, false);
  return classification.reasonCode;
}

void test('M2.5 retention grammar rejects every exact private-key marker across CR/LF forms', () => {
  for (const label of privateKeyLabels) {
    for (const boundary of ['BEGIN', 'END'] as const) {
      for (const separator of ['\n', '\r', '\r\n'] as const) {
        const value = `safe${separator}\t -----${boundary} ${label}----- \t${separator}safe`;
        assert.deepEqual(classifyM25IntakeRetainedText(value), {
          accepted: false,
          reasonCode: M25IntakeRetentionRejectionReason.PRIVATE_KEY_MARKER,
          observedByteCount: Buffer.byteLength(value, 'utf8'),
        });
      }
    }
  }
});

void test('M2.5 retention grammar rejects exact ASCII field markers and accepts fixed near misses', () => {
  for (const field of sensitiveFields) {
    for (const delimiter of [':', '='] as const) {
      const upper = field.toUpperCase();
      const value = `\t${upper}\t ${delimiter} retained-value`;
      assert.equal(classifyM25IntakeRetainedText(value).accepted, false, value);
    }
  }
  for (const nearMiss of [
    'prefix authorization: value',
    'authorization value',
    'authorization\u00a0: value',
    'authorization-value: value',
    '-----begin private key-----',
    '-----BEGIN  PRIVATE KEY-----',
    '-----BEGIN PRIVATE KEY----- suffix',
    'x-----BEGIN PRIVATE KEY-----',
    'this contains secret but no delimiter',
  ]) {
    assert.equal(classifyM25IntakeRetainedText(nearMiss).accepted, true, nearMiss);
  }
});

void test('M2.5 retention grammar rejects unpaired surrogates and only prohibited C0/C1 controls', () => {
  assert.equal(rejectionReason('\ud800'), M25IntakeRetentionRejectionReason.ILL_FORMED_UNICODE);
  for (const codePoint of [0x00, 0x01, 0x1f, 0x7f, 0x80, 0x9f]) {
    assert.equal(
      rejectionReason(`safe${String.fromCodePoint(codePoint)}text`),
      M25IntakeRetentionRejectionReason.PROHIBITED_CONTROL_CHARACTER,
    );
  }
  assert.equal(classifyM25IntakeRetainedText('safe\tline\nnext\rlast').accepted, true);
});
