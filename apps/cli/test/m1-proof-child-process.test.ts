import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
  completeM1ProofChildProcess,
  spawnM1ProofChildProcess,
} from '../dist/composition/m1-proof-child-process.js';

const COMPLETION_OPTIONS = Object.freeze({
  operation: 'M1 proof child-process test',
  timeoutMilliseconds: 2_000,
  cleanupTimeoutMilliseconds: 1_000,
});

function spawnNode(script: string, maxOutputBytes: number) {
  return spawnM1ProofChildProcess({
    executable: process.execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    environment: process.env,
    maxOutputBytes,
  });
}

void test('completed proof process waits for inherited stdout to close', async () => {
  const running = spawnNode(
    [
      "const { spawn } = require('node:child_process');",
      'const late = spawn(process.execPath,',
      "  ['-e', 'setTimeout(() => process.stdout.write(\\\"late-output\\\"), 100)'],",
      "  { stdio: ['ignore', 'inherit', 'inherit'] },",
      ');',
      'late.unref();',
    ].join('\n'),
    1_024,
  );

  const completed = await completeM1ProofChildProcess(running, COMPLETION_OPTIONS);

  assert.equal(completed.status, 0);
  assert.equal(completed.signal, null);
  assert.equal(completed.stdout, 'late-output');
  assert.equal(completed.stderr, '');
});

void test('proof process output limit is a hard retained-memory boundary', async () => {
  const maxOutputBytes = 64;
  const running = spawnNode("process.stdout.write('x'.repeat(4096));", maxOutputBytes);

  await assert.rejects(
    completeM1ProofChildProcess(running, COMPLETION_OPTIONS),
    /exceeded its 64 byte output limit/,
  );
  assert.ok(Buffer.byteLength(running.stdout()) <= maxOutputBytes);
  assert.ok(Buffer.byteLength(running.stderr()) <= maxOutputBytes);
  assert.ok(running.child.exitCode !== null || running.child.signalCode !== null);
});

void test('proof process timeout kills and closes the child before rejecting', async () => {
  const running = spawnNode('setInterval(() => {}, 1000);', 1_024);

  await assert.rejects(
    completeM1ProofChildProcess(running, {
      ...COMPLETION_OPTIONS,
      timeoutMilliseconds: 100,
    }),
    /timed out/,
  );
  assert.ok(running.child.exitCode !== null || running.child.signalCode !== null);
});

void test('proof process reports spawn failure after the failed handle closes', async () => {
  const running = spawnM1ProofChildProcess({
    executable: join(process.cwd(), 'definitely-missing-codeclosure-executable'),
    args: [],
    cwd: process.cwd(),
    environment: process.env,
    maxOutputBytes: 1_024,
  });

  await assert.rejects(
    completeM1ProofChildProcess(running, COMPLETION_OPTIONS),
    /could not be started/,
  );
  assert.ok(running.spawnError());
});
