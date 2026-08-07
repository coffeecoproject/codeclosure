import type {
  AppServerCompactionEvent,
  AppServerNotification,
} from '@codeclosure/codex-app-server-client';
import type { IntakeAssistantFailureReasonCode } from '@codeclosure/runtime';

import type { IntakeAdapterProtocolVersion } from './contracts.js';
import { IntakeProtocolProjection } from './projection.js';
import {
  IntakeProtocolObserver as M25IntakeProtocolObserver,
  type TerminalIntakeTurn as M25TerminalIntakeTurn,
} from './protocol.js';
import { M251IntakeProtocolObserver } from './protocol-v2.js';
import type { TerminalIntakeTurn as M251TerminalIntakeTurn } from './intake-observed-events.js';
import type { SafeIntakeDiagnosticCategory } from './intake-observed-events.js';

export type ProtocolTerminal =
  | Readonly<{ kind: 'M25_V1'; value: M25TerminalIntakeTurn }>
  | Readonly<{ kind: 'M251_V2'; value: M251TerminalIntakeTurn }>;

export interface IntakeProtocolObserverStrategy {
  readonly backendOperationRef: string | undefined;
  readonly backendSessionRef: string | undefined;
  readonly clientCallbacks: Readonly<{
    onCompactionEvent?: (event: AppServerCompactionEvent) => void;
    onNotification: (notification: AppServerNotification) => void;
  }>;
  readonly compactionCount: number;
  readonly failurePromise: Promise<IntakeAssistantFailureReasonCode>;
  readonly failureDiagnostic: SafeIntakeDiagnosticCategory | undefined;
  readonly failureReason: IntakeAssistantFailureReasonCode | undefined;
  readonly failureToken: string | undefined;
  readonly terminalPromise: Promise<ProtocolTerminal>;
  bindThread(threadId: string): void;
  bindTurn(turnId: string): void;
  selectFinalText(terminal: ProtocolTerminal): string;
}

function createM25Strategy(): IntakeProtocolObserverStrategy {
  const observer = new M25IntakeProtocolObserver();
  return {
    get backendOperationRef() {
      return observer.backendOperationRef;
    },
    get backendSessionRef() {
      return observer.backendSessionRef;
    },
    clientCallbacks: Object.freeze({
      onCompactionEvent: () => observer.recordCompaction(),
      onNotification: (notification) => observer.record(notification),
    }),
    get compactionCount() {
      return observer.compactionCount;
    },
    failurePromise: observer.failurePromise,
    failureDiagnostic: undefined,
    get failureReason() {
      return observer.failureReason;
    },
    failureToken: undefined,
    terminalPromise: observer.terminalPromise.then((value) =>
      Object.freeze({ kind: 'M25_V1' as const, value }),
    ),
    bindThread: (threadId) => observer.bindThread(threadId),
    bindTurn: (turnId) => observer.bindTurn(turnId),
    selectFinalText: (terminal) => {
      if (terminal.kind !== 'M25_V1') {
        throw new TypeError('Legacy Intake Observer received a foreign terminal projection');
      }
      return observer.selectFinalText(terminal.value);
    },
  };
}

function createM251Strategy(): IntakeProtocolObserverStrategy {
  const observer = new M251IntakeProtocolObserver();
  const projection = new IntakeProtocolProjection((event) => observer.record(event));
  return {
    get backendOperationRef() {
      return observer.backendOperationRef;
    },
    get backendSessionRef() {
      return observer.backendSessionRef;
    },
    clientCallbacks: Object.freeze({ onNotification: projection.record }),
    get compactionCount() {
      return observer.compactionCount;
    },
    failurePromise: observer.failurePromise,
    get failureDiagnostic() {
      return observer.failureDiagnostic;
    },
    get failureReason() {
      return observer.failureReason;
    },
    get failureToken() {
      return observer.failureToken;
    },
    terminalPromise: observer.terminalPromise.then((value) =>
      Object.freeze({ kind: 'M251_V2' as const, value }),
    ),
    bindThread: (threadId) => observer.bindThread(threadId),
    bindTurn: (turnId) => observer.bindTurn(turnId),
    selectFinalText: (terminal) => {
      if (terminal.kind !== 'M251_V2') {
        throw new TypeError('M2.5.1 Intake Observer received a foreign terminal projection');
      }
      return observer.selectFinalText(terminal.value);
    },
  };
}

export function createIntakeProtocolObserverStrategy(
  protocolVersion: IntakeAdapterProtocolVersion,
): IntakeProtocolObserverStrategy {
  return protocolVersion === 'M25_V1' ? createM25Strategy() : createM251Strategy();
}
