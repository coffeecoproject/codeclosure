export function parseNodeTestSummary(output) {
  const fields = new Map();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/u.exec(line);
    if (match !== null) {
      fields.set(match[1], Number(match[2]));
    }
  }

  const required = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];
  const missing = required.filter((field) => !fields.has(field));
  if (missing.length !== 0) {
    throw new TypeError(`Node test summary is missing: ${missing.join(', ')}`);
  }

  return Object.freeze(Object.fromEntries(required.map((field) => [field, fields.get(field)])));
}

export function testSummaryViolations(summary) {
  const violations = [];
  if (summary.fail !== 0) {
    violations.push(`${summary.fail} failed test(s)`);
  }
  if (summary.cancelled !== 0) {
    violations.push(`${summary.cancelled} cancelled test(s)`);
  }
  if (summary.skipped !== 0) {
    violations.push(`${summary.skipped} skipped test(s)`);
  }
  if (summary.todo !== 0) {
    violations.push(`${summary.todo} todo test(s)`);
  }
  return Object.freeze(violations);
}
