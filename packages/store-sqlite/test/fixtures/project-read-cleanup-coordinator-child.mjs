import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { CanonicalJsonSha256DigestProvider } from '@codeclosure/runtime';
import {
  CryptographicIdentityGenerator,
  SystemUtcClock,
  createProjectReadSnapshotCleanupCoordinator,
} from '@codeclosure/runtime/composition';
import { openSqliteControlStore } from '@codeclosure/store-sqlite';
import { createLocalProjectReadWorkspace } from '@codeclosure/workspace-local';

let coordinator;
let processBarrierRoot;
let store;
let state = 'WAITING_FOR_PREPARE';
const processBarrierParticipantCount = 2;
const processBarrierTimeoutMilliseconds = 10_000;
const processBarrierWaitCell = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

function field(value, key) {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

function send(message) {
  if (process.send === undefined) {
    throw new TypeError('Cleanup coordinator child requires an IPC channel');
  }
  process.send(message);
}

function closeStore() {
  if (store !== undefined) {
    store.close();
    store = undefined;
  }
}

function waitForPeerAtCleanupPort() {
  if (processBarrierRoot === undefined) {
    throw new TypeError('Cleanup coordinator child has no process barrier');
  }
  writeFileSync(join(processBarrierRoot, `port-ready-${String(process.pid)}`), '', {
    flag: 'wx',
    mode: 0o600,
  });
  const deadline = Date.now() + processBarrierTimeoutMilliseconds;
  while (
    readdirSync(processBarrierRoot).filter((name) => name.startsWith('port-ready-')).length <
    processBarrierParticipantCount
  ) {
    if (Date.now() >= deadline) {
      throw new TypeError('Cleanup coordinator child process barrier timed out');
    }
    Atomics.wait(processBarrierWaitCell, 0, 0, 10);
  }
}

function fail(error) {
  try {
    closeStore();
  } catch {
    // The original failure remains the useful test diagnostic.
  }
  send({
    kind: 'ERROR',
    message: error instanceof Error ? error.message : String(error),
    pid: process.pid,
  });
  process.disconnect();
}

process.on('message', (message) => {
  try {
    const kind = field(message, 'kind');
    if (kind === 'PREPARE' && state === 'WAITING_FOR_PREPARE') {
      const databaseFile = field(message, 'databaseFile');
      const options = field(message, 'options');
      const preparedProcessBarrierRoot = field(message, 'processBarrierRoot');
      if (
        typeof databaseFile !== 'string' ||
        typeof options !== 'object' ||
        options === null ||
        typeof preparedProcessBarrierRoot !== 'string'
      ) {
        throw new TypeError('Cleanup coordinator child received invalid preparation');
      }
      processBarrierRoot = preparedProcessBarrierRoot;
      store = openSqliteControlStore({ filename: databaseFile });
      const localWorkspace = createLocalProjectReadWorkspace(options);
      coordinator = createProjectReadSnapshotCleanupCoordinator({
        store,
        workspace: {
          cleanupSnapshot(grant) {
            waitForPeerAtCleanupPort();
            return localWorkspace.cleanupSnapshot(grant);
          },
        },
        clock: new SystemUtcClock(),
        ids: new CryptographicIdentityGenerator(),
        digests: new CanonicalJsonSha256DigestProvider(),
      });
      state = 'READY';
      send({ kind: 'READY', pid: process.pid });
      return;
    }
    if (kind === 'START' && state === 'READY') {
      const grant = field(message, 'grant');
      state = 'RUNNING';
      const result = coordinator.resolve({ grant });
      closeStore();
      state = 'DONE';
      send({
        kind: 'RESULT',
        outcomeDigest: result.outcome?.outcomeDigest ?? null,
        pid: process.pid,
        portInvoked: result.portInvoked,
        reasonCode: result.reasonCode ?? null,
        resolutionKind: result.resolutionKind ?? null,
        status: result.status,
      });
      process.disconnect();
      return;
    }
    throw new TypeError(`Cleanup coordinator child rejected ${String(kind)} in ${state}`);
  } catch (error) {
    fail(error);
  }
});

process.on('disconnect', () => {
  try {
    closeStore();
  } catch {
    // Process termination is already fail-closed for the test operation.
  }
});
