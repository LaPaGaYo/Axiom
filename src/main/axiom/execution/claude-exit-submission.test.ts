import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { submissionFixture, report } from './submission-fixture.test-support'
import { submitExitedAttempt, stopHeadlessAttemptWatchers } from './attempt-exit-submission'
import * as files from './headless-attempt-files'
import * as git from '../../git/runner'

let f: ReturnType<typeof submissionFixture>
let root: string
const init = {
  type: 'system',
  subtype: 'init',
  model: 'claude-opus-5',
  permissionMode: 'acceptEdits',
  claude_code_version: '2.1.309',
  skills: [],
  plugins: [],
  mcp_servers: [],
  session_id: 'session-claude'
}
const { filesChanged: _files, ...headlessReport } = report
const finalMessage = `Done\n\`\`\`json\n${JSON.stringify(headlessReport)}\n\`\`\``
beforeEach(async () => {
  f = submissionFixture()
  root = await mkdtemp(path.join(tmpdir(), 'axiom-claude-exit-'))
  vi.spyOn(files, 'headlessAttemptDirectory').mockReturnValue(root)
  f.db.db
    .prepare(
      'UPDATE worker_dispatches SET start_options = ?, worktree_id = ? WHERE dispatch_id = ?'
    )
    .run(JSON.stringify({ channel: 'headless', agent: 'claude' }), `repo::${root}`, f.t01.attemptId)
  await writeFile(
    path.join(root, 'launch.json'),
    JSON.stringify({
      provider: 'claude',
      baselineSha: 'c'.repeat(40),
      worktreeId: `repo::${root}`,
      branch: f.store.getAttemptBindingByDispatch(f.t01.attemptId)!.branch
    })
  )
  f.store.appendAuditEvent({
    missionId: f.mission.id,
    actor: 'AttemptLauncher',
    objectKind: 'attempt',
    objectId: f.t01.attemptId,
    event: 'attempt.headless_prepared',
    before: null,
    after: {
      combination: {
        requested: { model: 'policy-default', allowlist: { skills: [], mcpServers: [] } },
        effective: { harnessVersion: '2.1.309' }
      }
    }
  })
  vi.spyOn(git, 'gitExecFileAsync').mockResolvedValue({ stdout: 'actual.ts\u0000', stderr: '' })
})
afterEach(async () => {
  stopHeadlessAttemptWatchers(f.runtime)
  vi.clearAllTimers()
  vi.useRealTimers()
  f.db.close()
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
async function events(result?: Record<string, unknown>) {
  await writeFile(
    path.join(root, 'events.jsonl'),
    [init, ...(result ? [result] : [])].map((event) => JSON.stringify(event)).join('\n')
  )
}
it('audits init while running, then submits result.result once with usage/cost/denials', async () => {
  await events()
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('pending')
  expect(
    f.store
      .listAuditEvents({ missionId: f.mission.id })
      .filter((e) => e.event === 'attempt.launch_observed')
  ).toHaveLength(1)
  await events({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: finalMessage,
    usage: { input_tokens: 10, cache_read_input_tokens: 4, output_tokens: 2 },
    total_cost_usd: 0.01,
    permission_denials: []
  })
  await writeFile(path.join(root, 'exit-code'), '0\n')
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('submitted')
  expect(await readFile(path.join(root, 'last-message.md'), 'utf8')).toBe(finalMessage)
  expect(f.store.getSubmissionByDispatch(f.t01.attemptId)?.report.filesChanged).toEqual([
    'actual.ts'
  ])
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({
      event: 'attempt.submitted',
      after: expect.objectContaining({
        total_cost_usd: 0.01,
        permission_denials: [],
        usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 }
      })
    })
  )
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('unchanged')
})
it('refuses an error result even when exit is zero and a valid report is included', async () => {
  await events({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    errors: ['Not logged in'],
    result: finalMessage
  })
  await writeFile(path.join(root, 'exit-code'), '0\n')
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('interrupted')
  expect(f.store.getSubmissionByDispatch(f.t01.attemptId)).toBeUndefined()
})
it.each([undefined, { type: 'result', subtype: 'success', result: 42 }])(
  'refuses a Worker-written report without a valid Claude result (%s)',
  async (result) => {
    await events(result)
    await writeFile(path.join(root, 'last-message.md'), finalMessage)
    await writeFile(path.join(root, 'exit-code'), '0\n')
    expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('failed')
    expect(f.store.getSubmissionByDispatch(f.t01.attemptId)).toBeUndefined()
  }
)
it.each(['codex', undefined])('ignores a Worker-edited launch provider (%s)', async (provider) => {
  const launchPath = path.join(root, 'launch.json')
  const launch = JSON.parse(await readFile(launchPath, 'utf8'))
  await writeFile(launchPath, JSON.stringify({ ...launch, provider }))
  await events({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    errors: ['Not logged in']
  })
  await writeFile(path.join(root, 'last-message.md'), finalMessage)
  await writeFile(path.join(root, 'exit-code'), '0\n')
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('interrupted')
  expect(f.store.getSubmissionByDispatch(f.t01.attemptId)).toBeUndefined()
})
