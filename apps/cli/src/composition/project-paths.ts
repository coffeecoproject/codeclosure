import { isAbsolute, normalize, parse, resolve } from 'node:path';

import type { NormalizedProjectPathPort } from '@codeclosure/runtime';

/** Exact path parser used by the public application facade. */
export function createNormalizedProjectPathPort(): NormalizedProjectPathPort {
  return Object.freeze({
    parseNormalizedAbsolute: (projectPath: string): string => {
      if (projectPath.trim().length === 0 || !isAbsolute(projectPath)) {
        throw new TypeError('Project path must be a non-empty absolute path');
      }
      const normalized = normalize(resolve(projectPath));
      if (normalized === parse(normalized).root) {
        throw new TypeError('Project path must not be a filesystem root');
      }
      if (normalized !== projectPath) {
        throw new TypeError('Project path must already be normalized');
      }
      return projectPath;
    },
  });
}
