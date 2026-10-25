import { expect, it } from 'vitest'
import { workerProtocol } from './render'

it('renders the headless report contract and compaction recovery point without CLI instructions', () => {
  const text = workerProtocol('mission-1', 'task-1', 'headless')
  expect(text).toContain('.axiom/prompt.md')
  expect(text).toContain('re-read')
  expect(text).toContain('.axiom/artifacts/')
  expect(text).toContain('```json')
  expect(text).toContain('checksRun')
  expect(text).not.toContain('axiom attempt')
})
it('keeps the terminal protocol as the default fallback', () => {
  expect(workerProtocol('mission-1', 'task-1')).toContain(
    'axiom attempt submit --attempt {{attemptId}} --report <path.json>'
  )
})
