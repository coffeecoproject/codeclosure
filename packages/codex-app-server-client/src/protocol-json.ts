import type { JsonValue as GeneratedProtocolJsonValue } from './protocol/serde_json/JsonValue.js';
import { isJsonObject, type JsonValue } from './strict-json.js';

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** Copies validated client JSON into the mutable container shape used by generated protocol DTOs. */
export function toProtocolJsonValue(value: JsonValue): GeneratedProtocolJsonValue {
  if (isJsonArray(value)) {
    return value.map((entry) => toProtocolJsonValue(entry));
  }
  if (isJsonObject(value)) {
    const result: Record<string, GeneratedProtocolJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      Object.defineProperty(result, key, {
        configurable: false,
        enumerable: true,
        value: toProtocolJsonValue(entry),
        writable: false,
      });
    }
    return result;
  }
  return value;
}
