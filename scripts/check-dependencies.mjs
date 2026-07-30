import { error as writeError, log } from 'node:console';
import process from 'node:process';
import { resolve } from 'node:path';

import {
  auditPackageDependencies,
  formatDependencyAuditReport,
} from './check-dependencies-lib.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const audit = auditPackageDependencies(repositoryRoot);
log(formatDependencyAuditReport(audit).trimEnd());
if (audit.violations.length !== 0) {
  for (const violation of audit.violations) {
    writeError(violation);
  }
  process.exitCode = 1;
}
