import { createHash } from 'node:crypto';

import { sha256Digest, type Sha256Digest } from '@codeclosure/domain';

import { decodeJsonValue, type JsonValue } from './contracts.js';
import type { Canonicalizer, DigestProvider } from './ports.js';

function compareUtf16(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function assertUnicodeScalarSequence(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (!(trailing >= 0xdc00 && trailing <= 0xdfff)) {
        throw new TypeError('Canonical JSON strings must not contain lone UTF-16 surrogates');
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError('Canonical JSON strings must not contain lone UTF-16 surrogates');
    }
  }
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function serializeCanonical(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    assertUnicodeScalarSequence(value);
    return JSON.stringify(value);
  }
  if (isJsonArray(value)) {
    return `[${value.map((entry) => serializeCanonical(entry)).join(',')}]`;
  }

  const entries = Object.keys(value)
    .sort(compareUtf16)
    .map((key) => {
      assertUnicodeScalarSequence(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError('Canonical JSON object unexpectedly contains undefined');
      }
      return `${JSON.stringify(key)}:${serializeCanonical(decodeJsonValue(descriptor.value))}`;
    });
  return `{${entries.join(',')}}`;
}

/** RFC 8785 canonical JSON encoded as a JavaScript UTF-16 string. */
export function canonicalizeJson(value: unknown): string {
  return serializeCanonical(decodeJsonValue(value));
}

export class Rfc8785Canonicalizer implements Canonicalizer {
  public canonicalize(value: unknown): string {
    return canonicalizeJson(value);
  }
}

/** Node SHA-256 adapter for the repository's canonical JSON digest profile. */
export class CanonicalJsonSha256DigestProvider implements DigestProvider {
  public digest(value: unknown): Sha256Digest {
    const bytes = Buffer.from(canonicalizeJson(value), 'utf8');
    return sha256Digest(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
  }

  /** SHA-256 over the exact UTF-8 bytes of an uncanonicalized string. */
  public digestUtf8(value: string): Sha256Digest {
    const bytes = Buffer.from(value, 'utf8');
    return sha256Digest(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
  }
}
