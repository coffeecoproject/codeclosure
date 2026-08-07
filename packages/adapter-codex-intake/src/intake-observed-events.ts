export type SafeIntakeDiagnosticCategory =
  | 'LOWER_CLIENT_CORRELATION'
  | 'LOWER_CLIENT_LIMIT'
  | 'LOWER_CLIENT_UNSUPPORTED_OR_MALFORMED'
  | 'OBSERVER_BUDGET'
  | 'OBSERVER_CORRELATION'
  | 'OBSERVER_ORDER'
  | 'OBSERVER_TERMINAL_BINDING'
  | 'PROCESS_INTERRUPTED'
  | 'PROCESS_TIMEOUT'
  | 'PROCESS_UNAVAILABLE'
  | 'PROJECTED_FORBIDDEN_EFFECT'
  | 'PROJECTED_MALFORMED_PARAMS'
  | 'PROJECTED_UNMAPPED_LIFECYCLE'
  | 'RESPONSE_REJECTED';

export type IntakeMessagePhase = 'commentary' | 'final_answer' | null;

export interface ProjectedIntakeMessage {
  readonly digest: string;
  readonly id: string;
  readonly phase: IntakeMessagePhase;
  readonly text: string;
}

export type ProjectedTerminalItem =
  | Readonly<{ kind: 'MESSAGE'; message: ProjectedIntakeMessage }>
  | Readonly<{ kind: 'OTHER'; token: string }>;

export interface TerminalIntakeTurn {
  readonly errorPresent: boolean;
  readonly items: readonly ProjectedTerminalItem[];
  readonly itemsView: string | undefined;
  readonly status: string;
  readonly threadId: string;
  readonly turnId: string;
}

interface SequencedEvent {
  readonly sequence: number;
}

interface CorrelatedEvent extends SequencedEvent {
  readonly threadId: string;
  readonly turnId: string;
}

export type IntakeObservedEvent =
  | (SequencedEvent & Readonly<{ kind: 'THREAD_STARTED'; threadId: string }>)
  | (CorrelatedEvent & Readonly<{ kind: 'TURN_STARTED' }>)
  | (CorrelatedEvent & Readonly<{ kind: 'MESSAGE_STARTED'; message: ProjectedIntakeMessage }>)
  | (CorrelatedEvent & Readonly<{ kind: 'MESSAGE_COMPLETED'; message: ProjectedIntakeMessage }>)
  | (CorrelatedEvent & Readonly<{ kind: 'REASONING_OBSERVED' }>)
  | (CorrelatedEvent & Readonly<{ kind: 'USER_MESSAGE_OBSERVED' }>)
  | (CorrelatedEvent & Readonly<{ kind: 'STREAM_PROGRESS' }>)
  | (SequencedEvent & Readonly<{ kind: 'TURN_COMPLETED'; terminal: TerminalIntakeTurn }>)
  | (SequencedEvent &
      Readonly<{
        kind: 'BENIGN_PROCESS_PROJECTION';
        projection:
          | 'RATE_LIMITS_UPDATED'
          | 'REMOTE_CONTROL_DISABLED'
          | 'THREAD_STATUS_UPDATED'
          | 'THREAD_TOKEN_USAGE_UPDATED';
        threadId?: string;
        turnId?: string;
      }>)
  | (SequencedEvent &
      Readonly<{
        diagnostic: 'PROJECTED_FORBIDDEN_EFFECT';
        kind: 'FORBIDDEN_EFFECT_OBSERVED';
        threadId?: string;
        token: string;
        turnId?: string;
      }>)
  | (SequencedEvent &
      Readonly<{
        diagnostic: 'PROJECTED_MALFORMED_PARAMS' | 'PROJECTED_UNMAPPED_LIFECYCLE';
        kind: 'PROTOCOL_VIOLATION';
        token: string;
      }>);
