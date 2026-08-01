import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

export type AppServerProcessGroupKind = 'POSIX_PROCESS_GROUP' | 'WINDOWS_PROCESS';

export interface AppServerProcessIdentity {
  readonly schemaVersion: 1;
  readonly launchNonce: string;
  readonly processId: number;
  readonly processGroupId: number;
  readonly processGroupKind: AppServerProcessGroupKind;
  readonly processStartIdentity: string;
  readonly executableIdentityDigest: string;
  readonly controlledStateRootIdentity: string;
}

export type AppServerProcessReconciliationDisposition =
  'ABSENT' | 'TERMINATED' | 'IDENTITY_MISMATCH' | 'TERMINATION_FAILED' | 'UNAVAILABLE';

export interface AppServerProcessReconciliationResult {
  readonly schemaVersion: 1;
  readonly disposition: AppServerProcessReconciliationDisposition;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return value;
}

function boundedString(value: unknown, field: string, maximum = 16_384): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.includes('\u0000') ||
    Buffer.byteLength(value, 'utf8') > maximum
  ) {
    throw new TypeError(`${field} must be a bounded non-blank string`);
  }
  return value;
}

function digest(value: unknown, field: string): string {
  const result = boundedString(value, field, 71);
  if (!digestPattern.test(result)) {
    throw new TypeError(`${field} must be a SHA-256 digest`);
  }
  return result;
}

export function decodeAppServerProcessIdentity(value: unknown): AppServerProcessIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('App Server process identity must be an object');
  }
  const raw = value as Record<string, unknown>;
  const expected = [
    'schemaVersion',
    'launchNonce',
    'processId',
    'processGroupId',
    'processGroupKind',
    'processStartIdentity',
    'executableIdentityDigest',
    'controlledStateRootIdentity',
  ].sort();
  if (JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(expected)) {
    throw new TypeError('App Server process identity has unknown or missing fields');
  }
  if (raw['schemaVersion'] !== 1) {
    throw new TypeError('App Server process identity schema is unsupported');
  }
  const processGroupKind = raw['processGroupKind'];
  if (processGroupKind !== 'POSIX_PROCESS_GROUP' && processGroupKind !== 'WINDOWS_PROCESS') {
    throw new TypeError('App Server process-group kind is unsupported');
  }
  return Object.freeze({
    schemaVersion: 1,
    launchNonce: digest(raw['launchNonce'], 'launchNonce'),
    processId: positiveInteger(raw['processId'], 'processId'),
    processGroupId: positiveInteger(raw['processGroupId'], 'processGroupId'),
    processGroupKind,
    processStartIdentity: boundedString(raw['processStartIdentity'], 'processStartIdentity'),
    executableIdentityDigest: digest(raw['executableIdentityDigest'], 'executableIdentityDigest'),
    controlledStateRootIdentity: boundedString(
      raw['controlledStateRootIdentity'],
      'controlledStateRootIdentity',
    ),
  });
}

function linuxProcessStartIdentity(processId: number): string {
  const stat = readFileSync(`/proc/${String(processId)}/stat`, 'utf8');
  const close = stat.lastIndexOf(')');
  if (close < 0) {
    throw new TypeError('Linux process stat is malformed');
  }
  const fieldsAfterCommand = stat
    .slice(close + 2)
    .trim()
    .split(/\s+/u);
  const startTicks = fieldsAfterCommand[19];
  if (startTicks === undefined || !/^\d+$/u.test(startTicks)) {
    throw new TypeError('Linux process start identity is unavailable');
  }
  return `linux-proc-start:${startTicks}`;
}

function darwinProcessStartIdentity(processId: number): string {
  const result = spawnSync('/bin/ps', ['-o', 'lstart=', '-p', String(processId)], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024,
    shell: false,
  });
  const value = result.status === 0 ? result.stdout.trim().replace(/\s+/gu, ' ') : '';
  if (value.length === 0 || result.error !== undefined) {
    throw new TypeError('Darwin process start identity is unavailable');
  }
  return `darwin-ps-start:${value}`;
}

function processStartIdentity(processId: number): string {
  if (process.platform === 'linux') {
    return linuxProcessStartIdentity(processId);
  }
  if (process.platform === 'darwin') {
    return darwinProcessStartIdentity(processId);
  }
  throw new TypeError(`Process start identity is unsupported on ${process.platform}`);
}

export function captureAppServerProcessIdentity(input: {
  readonly processId: number;
  readonly launchNonce: string;
  readonly executableIdentityDigest: string;
  readonly controlledStateRootIdentity: string;
}): AppServerProcessIdentity {
  const processId = positiveInteger(input.processId, 'processId');
  if (process.platform === 'win32') {
    throw new TypeError('The bounded M2 process-group profile is unavailable on Windows');
  }
  return decodeAppServerProcessIdentity({
    schemaVersion: 1,
    launchNonce: input.launchNonce,
    processId,
    processGroupId: processId,
    processGroupKind: 'POSIX_PROCESS_GROUP',
    processStartIdentity: processStartIdentity(processId),
    executableIdentityDigest: input.executableIdentityDigest,
    controlledStateRootIdentity: input.controlledStateRootIdentity,
  });
}

type ProcessPresence = 'ACTIVE' | 'ABSENT' | 'ZOMBIE' | 'UNAVAILABLE';

function processPresence(processId: number): ProcessPresence {
  try {
    process.kill(processId, 0);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? Reflect.get(error, 'code') : undefined;
    return code === 'ESRCH' ? 'ABSENT' : 'UNAVAILABLE';
  }
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${String(processId)}/stat`, 'utf8');
      const close = stat.lastIndexOf(')');
      if (close < 0) {
        return 'UNAVAILABLE';
      }
      const state = stat
        .slice(close + 2)
        .trim()
        .split(/\s+/u)[0];
      return state === 'Z' ? 'ZOMBIE' : state === undefined ? 'UNAVAILABLE' : 'ACTIVE';
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error ? Reflect.get(error, 'code') : undefined;
      return code === 'ENOENT' || code === 'ESRCH' ? 'ABSENT' : 'UNAVAILABLE';
    }
  }
  if (process.platform === 'darwin') {
    const result = spawnSync('/bin/ps', ['-o', 'stat=', '-p', String(processId)], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024,
      shell: false,
    });
    const state = result.status === 0 ? result.stdout.trim().split(/\s+/u)[0] : undefined;
    if (state !== undefined && state.length > 0) {
      return state.startsWith('Z') ? 'ZOMBIE' : 'ACTIVE';
    }
    try {
      process.kill(processId, 0);
      return 'UNAVAILABLE';
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error ? Reflect.get(error, 'code') : undefined;
      return code === 'ESRCH' ? 'ABSENT' : 'UNAVAILABLE';
    }
  }
  return 'UNAVAILABLE';
}

function processExists(processId: number): boolean | 'UNAVAILABLE' {
  const presence = processPresence(processId);
  return presence === 'ACTIVE'
    ? true
    : presence === 'ABSENT' || presence === 'ZOMBIE'
      ? false
      : 'UNAVAILABLE';
}

function activePosixProcessGroupExists(processGroupId: number): boolean | 'UNAVAILABLE' {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,pgid=,stat='], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
  });
  if (result.status !== 0 || result.error !== undefined) {
    return 'UNAVAILABLE';
  }
  for (const rawLine of result.stdout.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const fields = line.split(/\s+/u);
    if (fields.length !== 3) {
      return 'UNAVAILABLE';
    }
    const observedProcessIdText = fields[0] ?? '';
    const observedProcessGroupIdText = fields[1] ?? '';
    const state = fields[2];
    if (
      !/^\d+$/u.test(observedProcessIdText) ||
      !/^\d+$/u.test(observedProcessGroupIdText) ||
      state === undefined
    ) {
      return 'UNAVAILABLE';
    }
    const observedProcessGroupId = Number.parseInt(observedProcessGroupIdText, 10);
    if (!Number.isSafeInteger(observedProcessGroupId)) {
      return 'UNAVAILABLE';
    }
    if (observedProcessGroupId === processGroupId && !state.startsWith('Z')) {
      return true;
    }
  }
  return false;
}

function processGroupExists(identity: AppServerProcessIdentity): boolean | 'UNAVAILABLE' {
  if (identity.processGroupKind !== 'POSIX_PROCESS_GROUP') {
    return processExists(identity.processId);
  }
  try {
    process.kill(-identity.processGroupId, 0);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? Reflect.get(error, 'code') : undefined;
    return code === 'ESRCH' ? false : 'UNAVAILABLE';
  }
  const leaderPresent = processExists(identity.processId);
  if (leaderPresent === true) {
    return true;
  }
  if (leaderPresent === 'UNAVAILABLE') {
    return 'UNAVAILABLE';
  }
  return activePosixProcessGroupExists(identity.processGroupId);
}

function signalOwnedProcess(identity: AppServerProcessIdentity, signal: NodeJS.Signals): boolean {
  try {
    if (identity.processGroupKind === 'POSIX_PROCESS_GROUP') {
      process.kill(-identity.processGroupId, signal);
    } else {
      process.kill(identity.processId, signal);
    }
    return true;
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? Reflect.get(error, 'code') : undefined;
    return code === 'ESRCH';
  }
}

function waitForOwnedProcessExit(
  identity: AppServerProcessIdentity,
  milliseconds: number,
): boolean {
  const deadline = Date.now() + milliseconds;
  while (Date.now() <= deadline) {
    const processPresent = processExists(identity.processId);
    const groupPresent = processGroupExists(identity);
    if (processPresent === false && groupPresent === false) {
      return true;
    }
    if (processPresent === 'UNAVAILABLE' || groupPresent === 'UNAVAILABLE') {
      return false;
    }
    Atomics.wait(waitBuffer, 0, 0, 10);
  }
  return processExists(identity.processId) === false && processGroupExists(identity) === false;
}

export function reconcileAppServerProcess(
  rawIdentity: unknown,
  limits: Readonly<{ gracefulMilliseconds?: number; killMilliseconds?: number }> = {},
): AppServerProcessReconciliationResult {
  const identity = decodeAppServerProcessIdentity(rawIdentity);
  const exists = processExists(identity.processId);
  if (exists === false) {
    const groupExists = processGroupExists(identity);
    return Object.freeze({
      schemaVersion: 1,
      disposition: groupExists === false ? 'ABSENT' : 'UNAVAILABLE',
    });
  }
  if (exists === 'UNAVAILABLE') {
    return Object.freeze({ schemaVersion: 1, disposition: 'UNAVAILABLE' });
  }
  let observedStartIdentity: string;
  try {
    observedStartIdentity = processStartIdentity(identity.processId);
  } catch {
    return Object.freeze({ schemaVersion: 1, disposition: 'UNAVAILABLE' });
  }
  if (observedStartIdentity !== identity.processStartIdentity) {
    return Object.freeze({ schemaVersion: 1, disposition: 'IDENTITY_MISMATCH' });
  }
  const gracefulMilliseconds = limits.gracefulMilliseconds ?? 500;
  const killMilliseconds = limits.killMilliseconds ?? 500;
  if (!signalOwnedProcess(identity, 'SIGTERM')) {
    return Object.freeze({ schemaVersion: 1, disposition: 'TERMINATION_FAILED' });
  }
  if (waitForOwnedProcessExit(identity, gracefulMilliseconds)) {
    return Object.freeze({ schemaVersion: 1, disposition: 'TERMINATED' });
  }
  if (
    !signalOwnedProcess(identity, 'SIGKILL') ||
    !waitForOwnedProcessExit(identity, killMilliseconds)
  ) {
    return Object.freeze({ schemaVersion: 1, disposition: 'TERMINATION_FAILED' });
  }
  return Object.freeze({ schemaVersion: 1, disposition: 'TERMINATED' });
}
