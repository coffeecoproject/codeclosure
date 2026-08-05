import { spawnSync } from 'node:child_process';
import { error as writeError } from 'node:console';
import process from 'node:process';

import { parseNodeTestSummary, testSummaryViolations } from './run-node-tests-lib.mjs';

if (process.argv.length < 3) {
  writeError('Usage: node scripts/run-node-tests.mjs <test-file> [<test-file> ...]');
  process.exitCode = 1;
} else {
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', ...process.argv.slice(2)],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  let failureMessage;
  if (result.error !== undefined) {
    failureMessage = `Node test runner failed to start: ${result.error.message}`;
  } else if (result.signal !== null) {
    failureMessage = `Node test runner terminated by signal ${result.signal}`;
  } else if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  } else {
    try {
      const summary = parseNodeTestSummary(result.stdout ?? '');
      const violations = testSummaryViolations(summary);
      if (violations.length !== 0) {
        failureMessage = violations
          .map((violation) => `M1 evidence cannot contain ${violation}.`)
          .join('\n');
        process.exitCode = 1;
      } else {
        if (process.env.CODECLOSURE_NODE_TEST_EVIDENCE === '1') {
          process.stdout.write(result.stdout ?? '');
        }
        process.stdout.write(
          `Node tests: PASS (${summary.pass}/${summary.tests}; fail=${summary.fail}, cancelled=${summary.cancelled}, skipped=${summary.skipped}, todo=${summary.todo})\n`,
        );
      }
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : 'Node test summary parsing failed';
      process.exitCode = 1;
    }
  }

  if (process.exitCode !== undefined || failureMessage !== undefined) {
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    if (failureMessage !== undefined) {
      writeError(failureMessage);
      process.exitCode = 1;
    }
  } else if ((result.stderr ?? '').length !== 0) {
    process.stderr.write(result.stderr);
  }
}
