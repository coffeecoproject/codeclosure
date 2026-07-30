import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';

const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

function fail(message) {
  throw new TypeError(message);
}

function assertUnicodeScalarSequence(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (!(trailing >= 0xdc00 && trailing <= 0xdfff)) {
        fail('Canonical JSON strings must not contain lone UTF-16 surrogates');
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      fail('Canonical JSON strings must not contain lone UTF-16 surrogates');
    }
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('Canonical JSON numbers must be finite');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    assertUnicodeScalarSequence(value);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (typeof value !== 'object' || value === undefined) {
    fail('Canonical JSON input contains a non-JSON value');
  }

  const entries = Object.keys(value)
    .sort()
    .map((key) => {
      assertUnicodeScalarSequence(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        fail('Canonical JSON object contains an unsupported property');
      }
      return `${JSON.stringify(key)}:${canonicalJson(descriptor.value)}`;
    });
  return `{${entries.join(',')}}`;
}

class DuplicateKeyScanner {
  #index = 0;

  constructor(source, sourceName) {
    this.source = source;
    this.sourceName = sourceName;
  }

  scan() {
    this.#skipWhitespace();
    this.#value();
    this.#skipWhitespace();
    if (this.#index !== this.source.length) {
      this.#error('contains trailing data');
    }
  }

  #error(message) {
    fail(`${this.sourceName} ${message} at code-unit offset ${this.#index}`);
  }

  #peek() {
    return this.source[this.#index];
  }

  #skipWhitespace() {
    while (/\s/u.test(this.#peek() ?? '')) {
      this.#index += 1;
    }
  }

  #expect(character) {
    if (this.#peek() !== character) {
      this.#error(`expected ${JSON.stringify(character)}`);
    }
    this.#index += 1;
  }

  #value() {
    const current = this.#peek();
    if (current === '{') {
      this.#object();
      return;
    }
    if (current === '[') {
      this.#array();
      return;
    }
    if (current === '"') {
      this.#string();
      return;
    }
    if (current === 't') {
      this.#literal('true');
      return;
    }
    if (current === 'f') {
      this.#literal('false');
      return;
    }
    if (current === 'n') {
      this.#literal('null');
      return;
    }
    this.#number();
  }

  #object() {
    this.#expect('{');
    this.#skipWhitespace();
    const keys = new Set();
    if (this.#peek() === '}') {
      this.#index += 1;
      return;
    }
    while (true) {
      if (this.#peek() !== '"') {
        this.#error('contains an object key that is not a string');
      }
      const key = this.#string();
      if (keys.has(key)) {
        this.#error(`contains duplicate object key ${JSON.stringify(key)}`);
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

  #array() {
    this.#expect('[');
    this.#skipWhitespace();
    if (this.#peek() === ']') {
      this.#index += 1;
      return;
    }
    while (true) {
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

  #string() {
    const start = this.#index;
    this.#expect('"');
    while (this.#index < this.source.length) {
      const current = this.source[this.#index];
      if (current === '"') {
        this.#index += 1;
        const token = this.source.slice(start, this.#index);
        try {
          return JSON.parse(token);
        } catch {
          this.#error('contains an invalid string');
        }
      }
      if (current === '\\') {
        this.#index += 1;
        const escaped = this.source[this.#index];
        if (escaped === 'u') {
          const unicodeEscape = this.source.slice(this.#index + 1, this.#index + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(unicodeEscape)) {
            this.#error('contains an invalid Unicode escape');
          }
          this.#index += 5;
          continue;
        }
        if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escaped)) {
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
    this.#error('contains an unterminated string');
  }

  #literal(literal) {
    if (!this.source.startsWith(literal, this.#index)) {
      this.#error('contains an invalid literal');
    }
    this.#index += literal.length;
  }

  #number() {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
      this.source.slice(this.#index),
    );
    if (match === null) {
      this.#error('contains an invalid value');
    }
    this.#index += match[0].length;
  }
}

export function parseJsonRejectingDuplicateKeys(source, sourceName = 'JSON input') {
  if (typeof source !== 'string') {
    fail(`${sourceName} must be a UTF-8 string`);
  }
  new DuplicateKeyScanner(source, sourceName).scan();
  try {
    return JSON.parse(source);
  } catch {
    fail(`${sourceName} is not valid JSON`);
  }
}

export function canonicalizeJsonText(source, sourceName = 'JSON input') {
  return canonicalJson(parseJsonRejectingDuplicateKeys(source, sourceName));
}

export function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function portablePath(root, path) {
  return relative(root, path).split(sep).join('/');
}

function filesUnder(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) {
      fail(`Generated output contains symbolic link: ${portablePath(root, path)}`);
    }
    if (entry.isDirectory()) {
      files.push(...filesUnder(path));
      continue;
    }
    if (!entry.isFile()) {
      fail(`Generated output contains a non-file entry: ${portablePath(root, path)}`);
    }
    files.push(path);
  }
  return files;
}

export function generatedDirectoryManifest(root, profile) {
  if (!['RAW_BYTES', 'RFC8785_JSON'].includes(profile)) {
    fail(`Unknown generated-directory profile: ${profile}`);
  }
  const absoluteRoot = realpathSync(root);
  const entries = filesUnder(absoluteRoot).map((path) => {
    const bytes = readFileSync(path);
    const relativePath = portablePath(absoluteRoot, path);
    if (profile === 'RAW_BYTES') {
      return Object.freeze({ path: relativePath, digest: sha256Bytes(bytes) });
    }
    if (!relativePath.endsWith('.json')) {
      fail(`JSON schema output contains a non-JSON file: ${relativePath}`);
    }
    let source;
    try {
      source = strictUtf8Decoder.decode(bytes);
    } catch {
      fail(`Generated JSON schema is not valid UTF-8: ${relativePath}`);
    }
    const canonicalBytes = Buffer.from(canonicalizeJsonText(source, relativePath), 'utf8');
    return Object.freeze({
      path: relativePath,
      digest: sha256Bytes(canonicalBytes),
      rawDigest: sha256Bytes(bytes),
    });
  });

  const aggregate = createHash('sha256');
  aggregate.update(`codex-generated-directory-v1\0${profile}\0`, 'utf8');
  for (const entry of entries) {
    aggregate.update(`${entry.path}\0${entry.digest}\0`, 'utf8');
  }
  return Object.freeze({
    profile,
    fileCount: entries.length,
    digest: `sha256:${aggregate.digest('hex')}`,
    entries: Object.freeze(entries),
  });
}

export function compareGeneratedManifests(left, right) {
  const leftEntries = new Map(left.entries.map((entry) => [entry.path, entry]));
  const rightEntries = new Map(right.entries.map((entry) => [entry.path, entry]));
  const allPaths = [...new Set([...leftEntries.keys(), ...rightEntries.keys()])].sort();
  const semanticDifferences = [];
  const rawDifferences = [];
  for (const path of allPaths) {
    const leftEntry = leftEntries.get(path);
    const rightEntry = rightEntries.get(path);
    if (leftEntry?.digest !== rightEntry?.digest) {
      semanticDifferences.push(path);
    }
    if (
      leftEntry?.rawDigest !== undefined &&
      rightEntry?.rawDigest !== undefined &&
      leftEntry.rawDigest !== rightEntry.rawDigest
    ) {
      rawDifferences.push(path);
    }
  }
  return Object.freeze({
    equal: semanticDifferences.length === 0,
    semanticDifferences: Object.freeze(semanticDifferences),
    rawDifferences: Object.freeze(rawDifferences),
  });
}

function containedBy(parent, child) {
  const path = relative(parent, child);
  return (
    path.length !== 0 && path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep)
  );
}

function exactDirectory(path, label) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(`${label} must be a real directory rather than a link or special entry`);
  }
  return realpathSync(path);
}

function assertNoSymlinkComponentsBelow(ownedRoot, target, label) {
  const lexicalOwnedRoot = resolve(ownedRoot);
  const lexicalTarget = resolve(target);
  if (!containedBy(lexicalOwnedRoot, lexicalTarget)) {
    fail(`${label} is outside the lexical owned workspace root`);
  }
  let current = lexicalOwnedRoot;
  for (const component of relative(lexicalOwnedRoot, lexicalTarget).split(sep)) {
    current = resolve(current, component);
    if (lstatSync(current).isSymbolicLink()) {
      fail(`${label} contains a symbolic-link component`);
    }
  }
}

export function validateCandidateWorkspaceLeaseRoot({
  ownedRoot,
  registeredRoot,
  requestedRoot,
  forbiddenRoots = [],
}) {
  assertNoSymlinkComponentsBelow(ownedRoot, registeredRoot, 'Registered Candidate root');
  assertNoSymlinkComponentsBelow(ownedRoot, requestedRoot, 'Requested Candidate root');
  const owned = exactDirectory(ownedRoot, 'Owned workspace root');
  const registered = exactDirectory(registeredRoot, 'Registered Candidate root');
  const requested = exactDirectory(requestedRoot, 'Requested Candidate root');
  if (!containedBy(owned, registered)) {
    fail('Registered Candidate root is outside the owned workspace root');
  }
  if (registered !== requested) {
    fail('Requested Candidate root does not equal the registered generation root');
  }
  for (const forbiddenRoot of forbiddenRoots) {
    const forbidden = realpathSync(forbiddenRoot);
    if (
      requested === forbidden ||
      containedBy(requested, forbidden) ||
      containedBy(forbidden, requested)
    ) {
      fail('Requested Candidate root intersects a forbidden authority or source root');
    }
  }
  return Object.freeze({ ownedRoot: owned, candidateRoot: requested });
}
