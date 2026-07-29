import { isAbsolute, parse, resolve } from 'node:path';

import { CliUsageError } from './parser.js';

export function resolveCliProjectPath(projectOperand: string, workingDirectory: string): string {
  if (!isAbsolute(workingDirectory)) {
    throw new TypeError('CLI working directory must be absolute');
  }
  const projectPath = resolve(workingDirectory, projectOperand);
  if (projectPath === parse(projectPath).root) {
    throw new CliUsageError('Project path must not resolve to a filesystem root.');
  }
  return projectPath;
}
