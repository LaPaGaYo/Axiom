import type { ClaudeOpenTurn } from './claude-open-turn'
import { claudeMissionSessionPins } from './claude-mission-session-pins'
import { claudeResultOutcome } from './claude-result-outcome'
import type { ClaudeStructuredSessionEvent } from './claude-structured-session-state'
import { isRootClaudeFrame } from './claude-turn-opening'

type MessageEvent = Extract<ClaudeStructuredSessionEvent, { type: 'message' }>

/** Mission callbacks also cover a started command that ends before any journal row.
 * One pending bit per acquisition is consumed at the root result/idle boundary. */
export class ClaudeMissionTurnSettlement {
  private pending = false
  private lastStartedCommand: string | null = null

  observe(event: ClaudeStructuredSessionEvent): void {
    if (event.type === 'ended') {
      this.pending = false
      return
    }
    if (
      event.type !== 'message' ||
      !isRootClaudeFrame(event.message) ||
      !claudeMissionSessionPins(event.sessionId)?.onTurnSettled
    ) {
      return
    }
    const { message } = event
    if (
      message.type === 'command_lifecycle' &&
      message.state === 'started' &&
      typeof message.command_uuid === 'string' &&
      message.command_uuid !== this.lastStartedCommand &&
      event.startedSend
    ) {
      this.lastStartedCommand = message.command_uuid
      this.pending = true
    }
    // The replay resolver has already removed this send's waiter. Its correlated
    // terminal result proves a turn even if neither a start nor an echo arrived.
    this.pending ||= event.resultAnsweredSend === true
  }

  result(turn: ClaudeOpenTurn, event: MessageEvent, wasOpen: boolean): void {
    if (turn.id === null) {
      this.settle(event, wasOpen)
    }
  }

  idle(turn: ClaudeOpenTurn, event: MessageEvent): void {
    if (
      claudeMissionSessionPins(event.sessionId)?.onTurnSettled &&
      !isRootClaudeFrame(event.message)
    ) {
      return
    }
    const wasOpen = turn.id !== null
    turn.settle({ state: 'completed', completedAt: event.observedAt ?? Date.now() })
    this.settle(event, wasOpen)
  }

  private settle(event: MessageEvent, wasOpen: boolean): void {
    if (!isRootClaudeFrame(event.message) || (!wasOpen && !this.pending)) {
      return
    }
    this.pending = false
    notifyClaudeMissionTurnSettled(event.sessionId, event.message)
  }
}

function notifyClaudeMissionTurnSettled(sessionId: string, message: Record<string, unknown>): void {
  const onTurnSettled = claudeMissionSessionPins(sessionId)?.onTurnSettled
  if (!onTurnSettled) {
    return
  }
  const isResult = message.type === 'result'
  const turns = message.num_turns
  const outcome = isResult ? claudeResultOutcome(message) : undefined
  try {
    onTurnSettled({
      outcome:
        outcome === 'success' || outcome === 'failure' || outcome === 'cancellation'
          ? outcome
          : 'unknown',
      isError: isResult && message.is_error === true,
      numTurns:
        isResult && typeof turns === 'number' && Number.isInteger(turns) && turns >= 0
          ? turns
          : null
    })
  } catch {
    // Caller evidence must not interrupt the kernel's own turn lifecycle.
    console.warn('[claude] Mission turn settlement callback failed', { sessionId })
  }
}
