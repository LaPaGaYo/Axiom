import { expect, it } from 'vitest'
import {
  parseHeadlessWorkerEvents,
  headlessFailureKind,
  parseHeadlessReport
} from './headless-worker-events'

const jsonl = (...events: unknown[]) => events.map((event) => JSON.stringify(event)).join('\n')
it('keeps the last turn usage as reported, the thread id, and ignores unknown/non-JSON lines', () => {
  const usage = {
    input_tokens: 100,
    cached_input_tokens: 60,
    output_tokens: 40,
    cache_write_input_tokens: 10,
    reasoning_output_tokens: 20
  }
  expect(
    parseHeadlessWorkerEvents(
      `${jsonl(
        { type: 'thread.started', thread_id: 'thread-1' },
        { type: 'turn.completed', usage: { input_tokens: 7 } },
        { type: 'future.event', usage: { input_tokens: 9999 } },
        { type: 'turn.completed', usage }
      )}\nnot json`
    )
  ).toMatchObject({ providerSessionId: 'thread-1', usage, hasEvents: true })
})
it.each([
  ['', 'interrupted'],
  [jsonl({ type: 'future.event' }), 'interrupted'],
  [
    jsonl({ type: 'turn.failed', error: { message: 'Authentication failed: login required' } }),
    'interrupted'
  ],
  [jsonl({ type: 'error', message: 'Quota exceeded' }), 'interrupted'],
  [
    jsonl({ type: 'turn.started' }, { type: 'turn.failed', error: { message: 'Task failed' } }),
    'failed'
  ]
])('classifies exit evidence: %s', (events, kind) => {
  expect(headlessFailureKind(parseHeadlessWorkerEvents(events))).toBe(kind)
})
it('prefers turn.failed evidence to later error notices', () => {
  expect(
    parseHeadlessWorkerEvents(
      jsonl(
        { type: 'turn.failed', error: { message: 'Task failed' } },
        { type: 'error', message: 'Reconnecting 2/5' }
      )
    ).lastError
  ).toBe('Task failed')
})
it('does not treat a reconnect notice as a failed turn', () => {
  const result = parseHeadlessWorkerEvents(
    jsonl(
      { type: 'error', message: 'Reconnecting 1/5' },
      { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 3 } }
    )
  )
  expect(result.turnFailed).toBe(false)
  expect(headlessFailureKind(result)).toBe('failed')
})
it('validates the final fenced report, refusing supplied filesChanged and trailing text', () => {
  const report = {
    summary: 'Done',
    checksRun: [],
    artifacts: [],
    limitations: [],
    risks: [],
    questions: [],
    followUps: []
  }
  const message = `Result\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\`\n`
  expect(parseHeadlessReport(message)).toEqual(report)
  expect(() => parseHeadlessReport(`${message}after`)).toThrow(/report/)
  expect(() =>
    parseHeadlessReport(message.replace('"summary"', '"filesChanged":[],"summary"'))
  ).toThrow()
})
