import {
  openVerifiedSqliteControlStore,
  type SqliteAuthorityIsolationSnapshot,
} from '@codeclosure/store-sqlite';

import {
  ProtectedPathKind,
  prepareCodeClosureAuthorityIsolationLease,
  prepareCodeClosureDataHome,
  prepareCodeClosureStateDatabase,
  type ProtectedPathInput,
} from './data-home.js';

export interface OpenCliSqliteAuthorityOptions {
  readonly dataHomePath: string;
  /** Invocation-known project and run-owned Candidate roots. */
  readonly protectedPaths: readonly ProtectedPathInput[];
  /** Exact invocation project paths that CreateGoal may persist. */
  readonly allowedProjectPaths: readonly string[];
  readonly expectedUserId?: number;
  readonly busyTimeoutMilliseconds?: number;
}

/**
 * Internal trusted-composition resource. This module is deliberately not the
 * public composition root: callers must finish Runtime recovery before a
 * narrow application facade can be published to the CLI entry point.
 */
export function openCliSqliteAuthority(options: OpenCliSqliteAuthorityOptions) {
  const preparedHome = prepareCodeClosureDataHome({
    path: options.dataHomePath,
    protectedPaths: options.protectedPaths,
    ...(options.expectedUserId === undefined ? {} : { expectedUserId: options.expectedUserId }),
  });
  const preparedDatabase = prepareCodeClosureStateDatabase(preparedHome, options.expectedUserId);

  return openVerifiedSqliteControlStore({
    filename: preparedDatabase.path,
    ...(options.busyTimeoutMilliseconds === undefined
      ? {}
      : { busyTimeoutMilliseconds: options.busyTimeoutMilliseconds }),
    isolationVerifier: Object.freeze({
      verify: (snapshot: SqliteAuthorityIsolationSnapshot) => {
        if (snapshot.databasePath !== preparedDatabase.path) {
          throw new TypeError('SQLite isolation snapshot does not identify the prepared database');
        }
        return prepareCodeClosureAuthorityIsolationLease({
          preparedHome,
          preparedDatabase,
          discoveredProtectedPaths: snapshot.projectReferences.map((reference) =>
            Object.freeze({
              kind: ProtectedPathKind.PROJECT,
              path: reference.projectPath,
            }),
          ),
          allowedProjectPaths: options.allowedProjectPaths,
          ...(options.expectedUserId === undefined
            ? {}
            : { expectedUserId: options.expectedUserId }),
        });
      },
    }),
  });
}
