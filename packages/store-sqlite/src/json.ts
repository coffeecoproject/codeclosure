import { decodeJsonValue, type JsonValue } from '@codeclosure/runtime';

import { PersistenceDecodeError } from './errors.js';

export type { JsonValue } from '@codeclosure/runtime';

export function serializeJson(value: JsonValue): string {
  const validated = decodeJsonValue(value);
  return JSON.stringify(validated);
}

export function parseJson(value: string, recordType: string): JsonValue {
  try {
    return decodeJsonValue(JSON.parse(value));
  } catch (error) {
    throw new PersistenceDecodeError(recordType, { cause: error });
  }
}
