import type { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = Readonly<{ [key: string]: JsonValue }>;

export interface JsonLimits {
  readonly maximumCollectionEntries: number;
  readonly maximumDepth: number;
  readonly maximumNodes: number;
}

const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

function fail(message: string): never {
  throw new TypeError(message);
}

class DuplicateKeyScanner {
  readonly #source: string;
  #index = 0;

  public constructor(source: string) {
    this.#source = source;
  }

  public scan(): void {
    this.#skipWhitespace();
    this.#value();
    this.#skipWhitespace();
    if (this.#index !== this.#source.length) {
      this.#error('contains trailing data');
    }
  }

  #error(message: string): never {
    return fail(`JSON ${message} at code-unit offset ${this.#index}`);
  }

  #peek(): string | undefined {
    return this.#source[this.#index];
  }

  #skipWhitespace(): void {
    while ([' ', '\t', '\r', '\n'].includes(this.#peek() ?? '')) {
      this.#index += 1;
    }
  }

  #expect(character: string): void {
    if (this.#peek() !== character) {
      this.#error(`expected ${JSON.stringify(character)}`);
    }
    this.#index += 1;
  }

  #value(): void {
    const current = this.#peek();
    if (current === '{') {
      this.#object();
    } else if (current === '[') {
      this.#array();
    } else if (current === '"') {
      this.#string();
    } else if (current === 't') {
      this.#literal('true');
    } else if (current === 'f') {
      this.#literal('false');
    } else if (current === 'n') {
      this.#literal('null');
    } else {
      this.#number();
    }
  }

  #object(): void {
    this.#expect('{');
    this.#skipWhitespace();
    const keys = new Set<string>();
    if (this.#peek() === '}') {
      this.#index += 1;
      return;
    }
    for (;;) {
      if (this.#peek() !== '"') {
        this.#error('contains an object key that is not a string');
      }
      const key = this.#string();
      if (keys.has(key)) {
        this.#error('contains a duplicate object key');
      }
      keys.add(key);
      this.#skipWhitespace();
      this.#expect(':');
      this.#skipWhitespace();
      this.#value();
      this.#skipWhitespace();
      if (this.#peek() === '}') {
        this.#index += 1;
        return;
      }
      this.#expect(',');
      this.#skipWhitespace();
    }
  }

  #array(): void {
    this.#expect('[');
    this.#skipWhitespace();
    if (this.#peek() === ']') {
      this.#index += 1;
      return;
    }
    for (;;) {
      this.#value();
      this.#skipWhitespace();
      if (this.#peek() === ']') {
        this.#index += 1;
        return;
      }
      this.#expect(',');
      this.#skipWhitespace();
    }
  }

  #string(): string {
    const start = this.#index;
    this.#expect('"');
    while (this.#index < this.#source.length) {
      const current = this.#source[this.#index];
      if (current === '"') {
        this.#index += 1;
        const token = this.#source.slice(start, this.#index);
        try {
          const parsed: unknown = JSON.parse(token);
          if (typeof parsed !== 'string') {
            return this.#error('contains an invalid string');
          }
          return parsed;
        } catch {
          return this.#error('contains an invalid string');
        }
      }
      if (current === '\\') {
        this.#index += 1;
        const escaped = this.#source[this.#index];
        if (escaped === 'u') {
          const unicodeEscape = this.#source.slice(this.#index + 1, this.#index + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(unicodeEscape)) {
            this.#error('contains an invalid Unicode escape');
          }
          this.#index += 5;
          continue;
        }
        if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escaped ?? '')) {
          this.#error('contains an invalid escape');
        }
        this.#index += 1;
        continue;
      }
      if (current === undefined || current.charCodeAt(0) < 0x20) {
        this.#error('contains an invalid control character');
      }
      this.#index += 1;
    }
    return this.#error('contains an unterminated string');
  }

  #literal(literal: string): void {
    if (!this.#source.startsWith(literal, this.#index)) {
      this.#error('contains an invalid literal');
    }
    this.#index += literal.length;
  }

  #number(): void {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
      this.#source.slice(this.#index),
    );
    if (match === null) {
      this.#error('contains an invalid value');
    }
    this.#index += match[0].length;
  }
}

function assertLimit(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${name} must be a positive safe integer`);
  }
}

function freezeBoundedJson(value: unknown, limits: JsonLimits): JsonValue {
  let nodes = 0;

  function visit(current: unknown, depth: number): JsonValue {
    nodes += 1;
    if (nodes > limits.maximumNodes) {
      return fail('JSON exceeds the node limit');
    }
    if (depth > limits.maximumDepth) {
      return fail('JSON exceeds the nesting-depth limit');
    }
    if (current === null || typeof current === 'boolean' || typeof current === 'string') {
      return current;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        return fail('JSON contains a non-finite number');
      }
      return current;
    }
    if (Array.isArray(current)) {
      if (current.length > limits.maximumCollectionEntries) {
        return fail('JSON array exceeds the collection-entry limit');
      }
      return Object.freeze(current.map((entry) => visit(entry, depth + 1)));
    }
    if (typeof current !== 'object') {
      return fail('JSON contains a non-JSON value');
    }
    const entries = Object.entries(current);
    if (entries.length > limits.maximumCollectionEntries) {
      return fail('JSON object exceeds the collection-entry limit');
    }
    const result: Record<string, JsonValue> = {};
    Object.setPrototypeOf(result, null);
    for (const [key, entry] of entries) {
      result[key] = visit(entry, depth + 1);
    }
    return Object.freeze(result);
  }

  return visit(value, 1);
}

export function parseBoundedJson(bytes: Buffer, limits: JsonLimits): JsonValue {
  assertLimit(limits.maximumCollectionEntries, 'maximumCollectionEntries');
  assertLimit(limits.maximumDepth, 'maximumDepth');
  assertLimit(limits.maximumNodes, 'maximumNodes');
  let source: string;
  try {
    source = strictUtf8Decoder.decode(bytes);
  } catch {
    return fail('JSON is not valid UTF-8');
  }
  new DuplicateKeyScanner(source).scan();
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return fail('JSON is malformed');
  }
  return freezeBoundedJson(parsed, limits);
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
