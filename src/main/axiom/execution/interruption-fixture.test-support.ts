import { vi } from 'vitest'
import { submissionFixture } from './submission-fixture.test-support'
import * as files from './headless-attempt-files'
import { getAxiomControlPlane } from '../control-plane'

export const interruptionNow = Date.parse('2026-11-09T12:00:00.000Z')
export function interruptionFixture() {
  const f = submissionFixture()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(interruptionNow)
  const plane = getAxiomControlPlane(f.runtime)
  const directory = '/tmp/axiom-interruption-fixture'
  let attemptId = f.t01.attemptId
  let events = JSON.stringify({ type: 'turn.failed', error: { message: 'Usage limit reached' } })
  let exit: string | undefined = '1'
  function prepare(id: string, provider = 'codex') {
    attemptId = id
    f.db.db
      .prepare(
        'UPDATE worker_dispatches SET start_options = ?, worktree_id = ? WHERE dispatch_id = ?'
      )
      .run(JSON.stringify({ channel: 'headless', agent: provider }), `repo::${directory}`, id)
  }
  prepare(attemptId)
  vi.spyOn(files, 'headlessAttemptDirectory').mockReturnValue(directory)
  vi.spyOn(files, 'persistClaudeLastMessage').mockResolvedValue()
  vi.spyOn(files, 'readHeadlessFile').mockImplementation(async (_directory, name) => {
    if (name === 'events.jsonl') {
      return events
    }
    if (name === 'exit-code') {
      return exit
    }
    if (name === 'last-message.md') {
      return ''
    }
    if (name === 'launch.json') {
      return JSON.stringify({
        baselineSha: 'c'.repeat(40),
        worktreeId: `repo::${directory}`,
        branch: f.store.getAttemptBindingByDispatch(attemptId)?.branch
      })
    }
    return undefined
  })
  const effect = (seq: number) => f.store.getEffect('attempt.continue', `${f.t01.taskId}/${seq}`)
  function next() {
    const worker = f.bind('T01')
    prepare(worker.attemptId)
    return worker.attemptId
  }
  return {
    ...f,
    plane,
    effect,
    next,
    prepare,
    setEvents: (rows: unknown[]) => {
      events = rows.map((row) => JSON.stringify(row)).join('\n')
    },
    setExit: (value: string | undefined) => {
      exit = value
    }
  }
}

export function claudeInterruptionEvents(reset = interruptionNow + 8000) {
  const sessionId = 'fixture-attempt-1'
  return [
    {
      type: 'rate_limit_event',
      session_id: sessionId,
      rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: reset / 1000 }
    },
    {
      type: 'assistant',
      session_id: sessionId,
      error: 'rate_limit',
      api_error: 'usage_limit_reached',
      is_api_error_message: true,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Fixture usage limit reached' }]
      }
    },
    {
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      errors: ['Fixture usage limit reached'],
      api_error_status: 429,
      terminal_reason: 'api_error',
      session_id: sessionId
    }
  ]
}
