import { createInterface } from 'node:readline';
import process from 'node:process';
import { setInterval, setTimeout } from 'node:timers';

const scenario = process.argv[2] ?? 'happy';
const appServerArguments = process.argv.slice(3);
const requests = [];
let initialized = false;
let pendingKnownServerRequest;
let pendingReorderedRequest;
let turnNumber = 0;

if (scenario === 'shutdown-hang') {
  setInterval(() => undefined, 1_000);
  process.on('SIGTERM', () => undefined);
}

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function sendRaw(value) {
  process.stdout.write(value);
}

function initializeResult(id, partial = false) {
  const observation = {
    appServerArguments,
    environmentNames: Object.keys(process.env).sort(),
    home: process.env.HOME,
    poisonPresent: Object.keys(process.env).some((name) => name.startsWith('CODECLOSURE_POISON')),
    secretPresent: process.env.OPENAI_API_KEY !== undefined,
  };
  const message = `${JSON.stringify({
    id,
    result: {
      codexHome: process.env.CODEX_HOME,
      platformFamily: 'fixture',
      platformOs: process.platform,
      userAgent: JSON.stringify(observation),
    },
  })}\n`;
  if (!partial) {
    sendRaw(message);
    return;
  }
  const first = Math.floor(message.length / 3);
  const second = Math.floor((message.length * 2) / 3);
  sendRaw(message.slice(0, first));
  setTimeout(() => sendRaw(message.slice(first, second)), 5);
  setTimeout(() => sendRaw(message.slice(second)), 10);
}

function respondToThreadStart(id) {
  send({ id, result: { thread: { id: 'thread-fixture', instructionSources: [] } } });
  send({
    method: 'thread/started',
    params: { thread: { id: 'thread-fixture', instructionSources: [] } },
  });
}

function handleInitialize(message) {
  if (scenario === 'pre-initialization-notification') {
    send({ method: 'warning', params: { message: 'too early' } });
    return;
  }
  if (scenario === 'prototype-injection') {
    sendRaw(
      `{"id":${String(message.id)},"result":{"__proto__":{"codexHome":${JSON.stringify(
        process.env.CODEX_HOME,
      )},"platformFamily":"forged","platformOs":"forged","userAgent":"forged"}}}\n`,
    );
    return;
  }
  if (scenario === 'malformed-json') {
    sendRaw('{not-json}\n');
    return;
  }
  if (scenario === 'duplicate-key') {
    sendRaw(`{"id":${String(message.id)},"id":${String(message.id)},"result":{}}\n`);
    return;
  }
  if (scenario === 'empty-line') {
    sendRaw('\n');
    return;
  }
  if (scenario === 'oversized-line') {
    send({ method: 'warning', params: { message: 'x'.repeat(8_192) } });
    return;
  }
  if (scenario === 'oversized-collection') {
    send({
      method: 'warning',
      params: { values: Array.from({ length: 32 }, (_, index) => index) },
    });
    return;
  }
  if (scenario === 'unexpected-eof') {
    process.exit(0);
  }
  if (scenario === 'nonzero-exit') {
    process.exit(7);
  }
  if (scenario === 'signal-exit') {
    process.kill(process.pid, 'SIGTERM');
    return;
  }
  if (scenario === 'request-timeout') {
    return;
  }
  if (scenario === 'stderr') {
    process.stderr.write('diagnostic-only\n'.repeat(1_024));
  }
  initializeResult(message.id, scenario === 'partial-lines');
}

function handleRequest(message) {
  requests.push(message.method);
  if (message.method === 'thread/start') {
    if (scenario === 'unknown-server-request') {
      send({ id: 'server-unknown', method: 'experimental/unknown', params: {} });
      return;
    }
    if (scenario === 'known-server-request') {
      pendingKnownServerRequest = message.id;
      send({
        id: 'server-known',
        method: 'item/commandExecution/requestApproval',
        params: {
          command: 'fixture',
          environmentId: null,
          itemId: 'item-fixture',
          reason: 'fixture',
          startedAtMs: 1,
          threadId: 'thread-fixture',
          turnId: 'turn-fixture',
        },
      });
      return;
    }
    if (scenario === 'host-cancel') {
      return;
    }
    if (scenario === 'unknown-notification') {
      send({ method: 'future/notification', params: {} });
      return;
    }
    if (scenario === 'duplicate-response') {
      respondToThreadStart(message.id);
      send({ id: message.id, result: { thread: { id: 'duplicate' } } });
      return;
    }
    if (scenario === 'conflicting-response') {
      send({
        error: { code: 1, message: 'conflict' },
        id: message.id,
        result: { thread: { id: 'conflict' } },
      });
      return;
    }
    if (scenario === 'unknown-response') {
      send({ id: 999_999, result: {} });
      return;
    }
    respondToThreadStart(message.id);
    if (scenario === 'compaction-flood') {
      for (let index = 1; index <= 3; index += 1) {
        send({
          method: 'item/started',
          params: {
            item: { id: `compaction-item-${String(index)}`, type: 'contextCompaction' },
            startedAtMs: index,
            threadId: 'thread-fixture',
            turnId: `compaction-turn-${String(index)}`,
          },
        });
      }
    }
    return;
  }
  if (
    scenario === 'reordered-responses' &&
    ['model/list', 'permissionProfile/list'].includes(message.method)
  ) {
    if (pendingReorderedRequest === undefined) {
      pendingReorderedRequest = message;
    } else {
      send({ id: message.id, result: { observedMethod: message.method } });
      send({
        id: pendingReorderedRequest.id,
        result: { observedMethod: pendingReorderedRequest.method },
      });
      pendingReorderedRequest = undefined;
    }
    return;
  }
  if (
    scenario === 'pending-process-exit' &&
    ['model/list', 'permissionProfile/list'].includes(message.method)
  ) {
    if (pendingReorderedRequest === undefined) {
      pendingReorderedRequest = message;
    } else {
      process.exit(9);
    }
    return;
  }
  if (message.method === 'turn/start') {
    turnNumber += 1;
    const turnId = `turn-${String(turnNumber)}`;
    send({ id: message.id, result: { turn: { id: turnId, items: [], status: 'inProgress' } } });
    send({
      method: 'turn/started',
      params: {
        threadId: message.params.threadId,
        turn: { id: turnId, items: [], status: 'inProgress' },
      },
    });
    if (scenario !== 'interrupt') {
      send({
        method: 'turn/completed',
        params: {
          threadId: message.params.threadId,
          turn: { id: turnId, items: [], status: 'completed' },
        },
      });
    }
    return;
  }
  if (message.method === 'thread/compact/start') {
    send({ id: message.id, result: {} });
    if (scenario === 'compaction-response-only') {
      send({
        method: 'warning',
        params: { message: `compaction-response-only:${message.params.threadId}` },
      });
      return;
    }
    const item = { id: 'compaction-item-1', type: 'contextCompaction' };
    send({
      method: 'item/started',
      params: {
        item,
        startedAtMs: 1,
        threadId: message.params.threadId,
        turnId: 'compaction-turn-1',
      },
    });
    send({
      method: 'item/completed',
      params: {
        completedAtMs: 2,
        item,
        threadId: message.params.threadId,
        turnId: 'compaction-turn-1',
      },
    });
    return;
  }
  if (message.method === 'turn/interrupt') {
    send({ id: message.id, result: {} });
    send({
      method: 'turn/completed',
      params: {
        threadId: message.params.threadId,
        turn: { id: message.params.turnId, items: [], status: 'interrupted' },
      },
    });
    send({ method: 'warning', params: { message: JSON.stringify({ requests }) } });
    return;
  }
  send({ error: { code: -32_601, message: 'Unsupported fixture request' }, id: message.id });
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.exit(20);
  }
  if (message.method === 'initialize') {
    if (initialized) {
      send({ error: { code: -32_600, message: 'Already initialized' }, id: message.id });
      return;
    }
    initialized = true;
    handleInitialize(message);
    return;
  }
  if (message.method === 'initialized') {
    return;
  }
  if (message.method !== undefined) {
    handleRequest(message);
    return;
  }
  if (message.id === 'server-known' && pendingKnownServerRequest !== undefined) {
    respondToThreadStart(pendingKnownServerRequest);
    pendingKnownServerRequest = undefined;
  }
});
