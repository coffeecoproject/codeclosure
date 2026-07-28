#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { checkDocumentation } from './check-docs-lib.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = checkDocumentation({ repositoryRoot });

if (result.errors.length > 0) {
  for (const error of result.errors) {
    process.stderr.write(`docs:check: ${error}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `docs:check: ${result.markdownFileCount} portable repository GFM sources, local links, heading anchors, and README status ownership passed.\n`,
  );
}
