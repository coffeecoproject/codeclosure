import { z } from 'zod';

import { PersistenceDecodeError } from './errors.js';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export function serializeJson(value: JsonValue): string {
  const validated = jsonValueSchema.parse(value);
  return JSON.stringify(validated);
}

export function parseJson(value: string, recordType: string): JsonValue {
  try {
    return jsonValueSchema.parse(JSON.parse(value));
  } catch (error) {
    throw new PersistenceDecodeError(recordType, { cause: error });
  }
}
