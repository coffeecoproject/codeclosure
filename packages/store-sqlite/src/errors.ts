export class SqliteStoreError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SqliteStoreError';
  }
}

export class MigrationIntegrityError extends SqliteStoreError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MigrationIntegrityError';
  }
}

export class PersistenceDecodeError extends SqliteStoreError {
  public constructor(recordType: string, options?: ErrorOptions) {
    super(`Stored ${recordType} failed boundary validation`, options);
    this.name = 'PersistenceDecodeError';
  }
}

export class OptimisticConcurrencyError extends SqliteStoreError {
  public constructor(aggregateType: string, aggregateId: string) {
    super(`Stale ${aggregateType} mutation rejected for ${aggregateId}`);
    this.name = 'OptimisticConcurrencyError';
  }
}

export class CommandIdConflictError extends SqliteStoreError {
  public constructor(commandId: string) {
    super(`Command ${commandId} was already used with different input`);
    this.name = 'CommandIdConflictError';
  }
}

export class StoreInvariantError extends SqliteStoreError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StoreInvariantError';
  }
}
