import type { IntakeAssistantFailureReasonCode } from '@codeclosure/runtime';

import type {
  IntakeObservedEvent,
  SafeIntakeDiagnosticCategory,
  TerminalIntakeTurn,
} from './intake-observed-events.js';

interface CompletedAgentMessage {
  readonly digest: string;
  readonly phase: 'commentary' | 'final_answer' | null;
}

function isCompactionToken(token: string): boolean {
  return (
    token === 'compaction' ||
    token === 'compaction_trigger' ||
    token === 'context_compaction' ||
    token === 'contextCompaction' ||
    token === 'thread/compacted'
  );
}

export class M251IntakeProtocolObserver {
  #backendOperationRef?: string;
  #backendSessionRef?: string;
  #compactionCount = 0;
  readonly #completedAgentMessages: CompletedAgentMessage[] = [];
  #failureDiagnostic?: SafeIntakeDiagnosticCategory;
  #failureReason?: IntakeAssistantFailureReasonCode;
  #failureToken?: string;
  readonly #failurePromise: Promise<IntakeAssistantFailureReasonCode>;
  #failureResolve!: (reason: IntakeAssistantFailureReasonCode) => void;
  #lastSequence = 0;
  #notificationCount = 0;
  readonly #observedThreadRefs = new Set<string>();
  readonly #observedTurnRefs = new Set<string>();
  #threadStarted = false;
  readonly #terminalPromise: Promise<TerminalIntakeTurn>;
  #terminalResolve!: (terminal: TerminalIntakeTurn) => void;
  #terminalSeen = false;
  #turnStarted = false;

  public constructor() {
    this.#failurePromise = new Promise((resolve) => {
      this.#failureResolve = resolve;
    });
    this.#terminalPromise = new Promise((resolve) => {
      this.#terminalResolve = resolve;
    });
  }

  public get backendOperationRef(): string | undefined {
    return this.#backendOperationRef;
  }

  public get backendSessionRef(): string | undefined {
    return this.#backendSessionRef;
  }

  public get compactionCount(): number {
    return this.#compactionCount;
  }

  public get failureDiagnostic(): SafeIntakeDiagnosticCategory | undefined {
    return this.#failureDiagnostic;
  }

  public get failurePromise(): Promise<IntakeAssistantFailureReasonCode> {
    return this.#failurePromise;
  }

  public get failureReason(): IntakeAssistantFailureReasonCode | undefined {
    return this.#failureReason;
  }

  public get failureToken(): string | undefined {
    return this.#failureToken;
  }

  public get terminalPromise(): Promise<TerminalIntakeTurn> {
    return this.#terminalPromise;
  }

  public bindThread(threadId: string): void {
    this.#backendSessionRef = threadId;
    this.#validateRefs();
  }

  public bindTurn(turnId: string): void {
    this.#backendOperationRef = turnId;
    this.#validateRefs();
  }

  public fail(
    reason: IntakeAssistantFailureReasonCode,
    diagnostic: SafeIntakeDiagnosticCategory,
    token: string,
  ): void {
    if (this.#failureReason === undefined) {
      this.#failureReason = reason;
      this.#failureDiagnostic = diagnostic;
      this.#failureToken = token;
      this.#failureResolve(reason);
    }
  }

  public record(event: IntakeObservedEvent): void {
    if (this.#failureReason !== undefined) {
      return;
    }
    this.#notificationCount += 1;
    if (this.#notificationCount > 10_000) {
      this.fail('ASSISTANT_PROTOCOL_ERROR', 'OBSERVER_BUDGET', 'NOTIFICATION_COUNT');
      return;
    }
    if (event.sequence <= this.#lastSequence) {
      this.fail('ASSISTANT_PROTOCOL_ERROR', 'OBSERVER_ORDER', 'EVENT_SEQUENCE');
      return;
    }
    this.#lastSequence = event.sequence;
    try {
      switch (event.kind) {
        case 'THREAD_STARTED':
          if (this.#threadStarted || this.#turnStarted || this.#terminalSeen) {
            this.fail('ASSISTANT_PROTOCOL_ERROR', 'OBSERVER_ORDER', event.kind);
            return;
          }
          this.#threadStarted = true;
          this.#observedThreadRefs.add(event.threadId);
          break;
        case 'TURN_STARTED':
          if (!this.#threadStarted || this.#turnStarted || this.#terminalSeen) {
            this.fail('ASSISTANT_PROTOCOL_ERROR', 'OBSERVER_ORDER', event.kind);
            return;
          }
          this.#turnStarted = true;
          this.#observeCorrelation(event.threadId, event.turnId);
          break;
        case 'MESSAGE_STARTED':
        case 'REASONING_OBSERVED':
        case 'STREAM_PROGRESS':
        case 'USER_MESSAGE_OBSERVED':
          if (!this.#turnStarted || this.#terminalSeen) {
            this.fail('ASSISTANT_PROTOCOL_ERROR', 'OBSERVER_ORDER', event.kind);
            return;
          }
          this.#observeCorrelation(event.threadId, event.turnId);
          break;
        case 'MESSAGE_COMPLETED':
          if (!this.#turnStarted || this.#terminalSeen) {
            this.fail('ASSISTANT_PROTOCOL_ERROR', 'OBSERVER_ORDER', event.kind);
            return;
          }
          this.#observeCorrelation(event.threadId, event.turnId);
          if (this.#completedAgentMessages.length >= 16) {
            this.fail('ASSISTANT_PROTOCOL_ERROR', 'OBSERVER_BUDGET', 'COMPLETED_MESSAGE_COUNT');
            return;
          }
          this.#completedAgentMessages.push(
            Object.freeze({ digest: event.message.digest, phase: event.message.phase }),
          );
          break;
        case 'TURN_COMPLETED':
          if (!this.#turnStarted || this.#terminalSeen) {
            this.fail('ASSISTANT_PROTOCOL_ERROR', 'OBSERVER_ORDER', event.kind);
            return;
          }
          this.#terminalSeen = true;
          this.#observeCorrelation(event.terminal.threadId, event.terminal.turnId);
          this.#terminalResolve(event.terminal);
          break;
        case 'BENIGN_PROCESS_PROJECTION':
          if (this.#terminalSeen) {
            this.fail('ASSISTANT_PROTOCOL_ERROR', 'OBSERVER_ORDER', event.kind);
            return;
          }
          if (event.threadId !== undefined) {
            this.#observedThreadRefs.add(event.threadId);
          }
          if (event.turnId !== undefined) {
            this.#observedTurnRefs.add(event.turnId);
          }
          break;
        case 'FORBIDDEN_EFFECT_OBSERVED':
          this.fail('ASSISTANT_PROTOCOL_ERROR', event.diagnostic, event.token);
          return;
        case 'PROTOCOL_VIOLATION':
          if (isCompactionToken(event.token)) {
            this.#compactionCount += 1;
          }
          this.fail('ASSISTANT_PROTOCOL_ERROR', event.diagnostic, event.token);
          return;
      }
      this.#validateRefs();
    } catch {
      this.fail('ASSISTANT_PROTOCOL_ERROR', 'OBSERVER_CORRELATION', 'REFERENCE_VALIDATION');
    }
  }

  public selectFinalText(terminal: TerminalIntakeTurn): string {
    if (
      terminal.threadId !== this.#backendSessionRef ||
      terminal.turnId !== this.#backendOperationRef ||
      terminal.status !== 'completed' ||
      terminal.errorPresent ||
      terminal.itemsView !== 'summary' ||
      terminal.items.length !== 1 ||
      terminal.items[0]?.kind !== 'MESSAGE'
    ) {
      this.fail('ASSISTANT_PROTOCOL_ERROR', 'OBSERVER_TERMINAL_BINDING', 'TERMINAL_BINDING');
      throw new TypeError('terminal Turn does not bind the current successful operation');
    }
    const message = terminal.items[0].message;
    if (message.phase !== 'final_answer' && message.phase !== null) {
      this.fail('ASSISTANT_PROTOCOL_ERROR', 'OBSERVER_TERMINAL_BINDING', 'MESSAGE_PHASE');
      throw new TypeError('terminal summary is not a final agent message');
    }
    const matching = this.#completedAgentMessages.filter(
      (completed) => completed.digest === message.digest && completed.phase === message.phase,
    );
    if (matching.length !== 1 || this.#completedAgentMessages.length !== 1) {
      this.fail('ASSISTANT_PROTOCOL_ERROR', 'OBSERVER_TERMINAL_BINDING', 'MESSAGE_BINDING');
      throw new TypeError('terminal summary does not bind one completed agent message');
    }
    return message.text;
  }

  #observeCorrelation(threadId: string, turnId: string): void {
    this.#observedThreadRefs.add(threadId);
    this.#observedTurnRefs.add(turnId);
  }

  #validateRefs(): void {
    if (
      this.#backendSessionRef !== undefined &&
      [...this.#observedThreadRefs].some((reference) => reference !== this.#backendSessionRef)
    ) {
      this.fail('ASSISTANT_PROTOCOL_ERROR', 'OBSERVER_CORRELATION', 'THREAD_REFERENCE');
    }
    if (
      this.#backendOperationRef !== undefined &&
      [...this.#observedTurnRefs].some((reference) => reference !== this.#backendOperationRef)
    ) {
      this.fail('ASSISTANT_PROTOCOL_ERROR', 'OBSERVER_CORRELATION', 'TURN_REFERENCE');
    }
  }
}
