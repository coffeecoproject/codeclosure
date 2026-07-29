import { error as writeError } from 'node:console';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { checkCliBoundary } from './check-cli-boundary-lib.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const violations = checkCliBoundary(repositoryRoot);
if (violations.length !== 0) {
  for (const item of violations) {
    writeError(`${item.filePath}:${item.line}:${item.column}: ${item.reason} (${item.specifier})`);
  }
  process.exitCode = 1;
}
