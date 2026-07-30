export const AppServerClientErrorCode = Object.freeze({
  HOST_CANCELLED: 'HOST_CANCELLED',
  HOST_HANDLER_FAILED: 'HOST_HANDLER_FAILED',
  INITIALIZATION_FAILED: 'INITIALIZATION_FAILED',
  INVALID_LAUNCH: 'INVALID_LAUNCH',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
  PROCESS_EXITED: 'PROCESS_EXITED',
  PROTOCOL_CORRELATION: 'PROTOCOL_CORRELATION',
  PROTOCOL_LIMIT: 'PROTOCOL_LIMIT',
  PROTOCOL_MALFORMED: 'PROTOCOL_MALFORMED',
  REQUEST_REJECTED: 'REQUEST_REJECTED',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  SERVER_REQUEST_FAILED: 'SERVER_REQUEST_FAILED',
  SHUTDOWN: 'SHUTDOWN',
  SHUTDOWN_TIMEOUT: 'SHUTDOWN_TIMEOUT',
  SPAWN_FAILED: 'SPAWN_FAILED',
  STREAM_FAILED: 'STREAM_FAILED',
  UNSUPPORTED_METHOD: 'UNSUPPORTED_METHOD',
  UNSUPPORTED_SERVER_REQUEST: 'UNSUPPORTED_SERVER_REQUEST',
  VERSION_MISMATCH: 'VERSION_MISMATCH',
} as const);

export type AppServerClientErrorCode =
  (typeof AppServerClientErrorCode)[keyof typeof AppServerClientErrorCode];

export type SafeErrorDetail = Readonly<
  Record<string, boolean | number | string | null | undefined>
>;

export class AppServerClientError extends Error {
  public readonly code: AppServerClientErrorCode;
  public readonly detail: SafeErrorDetail;

  public constructor(
    code: AppServerClientErrorCode,
    message: string,
    detail: SafeErrorDetail = Object.freeze({}),
  ) {
    super(message);
    this.name = 'AppServerClientError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

export function clientError(
  code: AppServerClientErrorCode,
  message: string,
  detail?: SafeErrorDetail,
): AppServerClientError {
  return new AppServerClientError(code, message, detail);
}
