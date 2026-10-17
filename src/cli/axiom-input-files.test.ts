import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { readGoalFile, readPlanFile } from './handlers/axiom/input-files'
import { dispatch } from './dispatch'
import { RuntimeClient } from './runtime-client'
import { formatTaskList } from './axiom-format'

const directories: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true })
  }
})
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'axiom-input-'))
  directories.push(path)
  return path
}

it('loads Markdown as objective text and keeps unchanged retries stable', async () => {
  const cwd = directory()
  const text = '# Goal\n\nShip the feature.\n'
  writeFileSync(join(cwd, 'goal.md'), text)
  const first = await readGoalFile(cwd, 'goal.md')
  expect(first).toMatchObject({
    objective: text,
    constraints: [],
    acceptanceCriteria: [],
    provenance: { kind: 'user', at: statSync(join(cwd, 'goal.md')).mtime.toISOString() }
  })
  expect(await readGoalFile(cwd, 'goal.md')).toEqual(first)
  const client = new RuntimeClient(cwd, 500, null, null)
  const call = vi
    .spyOn(client, 'call')
    .mockResolvedValue({ id: 'rpc', ok: true, result: {}, _meta: { runtimeId: 'test' } })
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  const flags = new Map([
    ['repo', 'fixture'],
    ['target-branch', 'main'],
    ['goal-file', 'goal.md'],
    ['retry-request', '11111111-1111-4111-8111-111111111111']
  ])
  await dispatch(['mission', 'create'], { flags, client, cwd, json: true })
  expect(call.mock.calls[0]?.[2]).toEqual({
    orchestrationRequestId: '11111111-1111-4111-8111-111111111111'
  })
})

it.each(['{', '{}', 'null', '[]'])('rejects malformed goal and plan files: %s', async (text) => {
  const cwd = directory()
  writeFileSync(join(cwd, 'bad.json'), text)
  await expect(readGoalFile(cwd, 'bad.json')).rejects.toMatchObject({ code: 'invalid_argument' })
  await expect(readPlanFile(cwd, 'bad.json')).rejects.toMatchObject({ code: 'invalid_argument' })
})

it('rejects absent files and unsupported goal extensions', async () => {
  const cwd = directory()
  writeFileSync(join(cwd, 'goal.txt'), 'Goal')
  await expect(readGoalFile(cwd, 'missing.md')).rejects.toMatchObject({ code: 'invalid_argument' })
  await expect(readGoalFile(cwd, 'goal.txt')).rejects.toMatchObject({ code: 'invalid_argument' })
})

it('renders Task stage even when the Orca execution projection is completed', () => {
  expect(
    formatTaskList({
      tasks: [
        {
          id: 't1',
          missionId: 'm1',
          planRevisionId: 'p1',
          title: 'Task',
          stage: 'SUBMITTED',
          orcaStatus: 'completed'
        }
      ]
    })
  ).toBe('ID\tSTAGE\tTITLE\nt1\tSUBMITTED\tTask')
})
