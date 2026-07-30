import { error as writeError, log } from 'node:console';
import process from 'node:process';
import { resolve } from 'node:path';

import { auditInvariantCoverage, formatInvariantCoverageReport } from './check-invariants-lib.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const audit = auditInvariantCoverage(repositoryRoot);
log(formatInvariantCoverageReport(audit).trimEnd());
if (audit.violations.length !== 0) {
  for (const violation of audit.violations) {
    writeError(violation);
  }
  process.exitCode = 1;
}
