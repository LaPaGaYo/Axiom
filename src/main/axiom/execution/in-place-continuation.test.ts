import { expect, it, vi } from 'vitest'
import { decideInPlaceContinuation, type ContinuationReaders } from './in-place-continuation'
import type { AttemptBaseline } from './attempt-baseline'

const snapshot = {
  ref: 'refs/axiom/preserved/t/1',
  commitSha: 'a'.repeat(40),
  treeSha: 'b'.repeat(40)
}
const baseline: AttemptBaseline = {
  kind: 'snapshot',
  previousSeq: 1,
  attemptId: 'd1',
  snapshot,
  baselineSha: 'c'.repeat(40),
  scopePaths: ['code.txt'],
  skippedAttempts: [],
  ending: { kind: 'interrupted', failureClass: 'usage_limit' },
  underlying: { kind: 'integration', reason: 'first_attempt' }
}
function evidence() {
  const previous = {
    seq: 1,
    dispatchId: 'd1',
    branch: 'axiom/attempt/t/1',
    submitted: false,
    stopped: false,
    failure: {
      reason: 'process_exited',
      evidence: 'exit_code',
      exitCode: 75,
      settlement: { kind: 'interrupted' },
      providerSessionId: 'thread-1'
    },
    preservation: {
      taskId: 't',
      baselineSha: 'c'.repeat(40),
      result: { status: 'preserved', snapshot, scopePaths: ['code.txt'], secrets: [] }
    }
  }
  const agent = {
    provider: 'codex' as const,
    model: 'policy-default',
    reasoning: { effort: 'medium' as const }
  }
  const manifest = {
    planRevisionId: 'p',
    mandatory: [
      { section: 'Task spec', sha256: 'a' },
      { section: 'Previous-Attempt failure evidence', sha256: 'b' },
      { section: 'Answered questions', sha256: 'c' }
    ]
  }
  const readers: ContinuationReaders = {
    previous: vi.fn(() => previous),
    agents: vi.fn(() => ({ previous: agent, current: agent })),
    version: vi.fn(async () => 'codex-cli 0.163.0'),
    accounts: vi.fn(() => ({ previous: '/account', current: '/account' })),
    manifests: vi.fn(() => ({ previous: manifest, current: manifest })),
    thread: vi.fn(async () => undefined),
    originStartedAt: vi.fn(() => 1000),
    recordExists: vi.fn(async () => true),
    worktree: vi.fn(async () => ({
      worktree: { id: 'repo::/worktree', path: '/worktree' },
      targetCommit: snapshot.commitSha,
      parentCommit: 'c'.repeat(40),
      treeSha: snapshot.treeSha
    }))
  }
  const run = (selected = baseline) => decideInPlaceContinuation('t', selected, readers)
  return { readers, previous, agent, manifest, run }
}
const fresh = (reason: string) => ({ strategy: 'fresh', reason })

it('continues an interrupted Codex Attempt in its own worktree and resumes its session', async () => {
  const f = evidence()
  expect(await f.run()).toMatchObject({
    strategy: 'resumed_in_place',
    id: 'thread-1',
    originSeq: 1,
    fromSeq: 1,
    worktree: { id: 'repo::/worktree', path: '/worktree' },
    targetCommit: snapshot.commitSha
  })
})
it('continues in place when the interrupted Attempt changed nothing', async () => {
  const f = evidence()
  vi.mocked(f.readers.previous).mockReturnValue({
    ...f.previous,
    preservation: { taskId: 't', baselineSha: 'c'.repeat(40), result: { status: 'empty' } }
  })
  expect(
    await f.run({
      kind: 'integration',
      reason: 'previous_attempt_not_submitted',
      skippedAttempts: []
    })
  ).toMatchObject({ strategy: 'resumed_in_place', preserved: false })
})
it('continues in place after a restart in which the host saw the process exit', async () => {
  const f = evidence()
  vi.mocked(f.readers.previous).mockReturnValue({
    ...f.previous,
    failure: {
      reason: 'process_exited',
      evidence: 'runtime_restarted',
      settlement: { kind: 'interrupted' }
    }
  })
  vi.mocked(f.readers.thread).mockResolvedValue('thread-1')
  expect(await f.run()).toMatchObject({
    strategy: 'resumed_in_place',
    ending: { evidence: 'runtime_restarted' }
  })
})
it('keeps continuing in place across Attempts that resumed the same session', async () => {
  const f = evidence()
  vi.mocked(f.readers.previous).mockReturnValue({
    ...f.previous,
    seq: 2,
    session: { strategy: 'resumed_in_place', id: 'thread-1', originSeq: 1, fromSeq: 1 }
  })
  expect(await f.run({ ...baseline, previousSeq: 2 })).toMatchObject({ originSeq: 1, fromSeq: 2 })
  expect(f.readers.originStartedAt).toHaveBeenCalledWith(1)
})
it('starts a new worktree and session when the previous Attempt was stopped or failed', async () => {
  for (const overrides of [
    { stopped: true },
    { submitted: true },
    { failure: {} },
    {
      failure: {
        settlement: { kind: 'failed' }
      }
    }
  ]) {
    const f = evidence()
    vi.mocked(f.readers.previous).mockReturnValue({ ...f.previous, ...overrides })
    expect(await f.run()).toEqual(fresh('not_interrupted'))
    expect(f.readers.agents).not.toHaveBeenCalled()
  }
})
it('starts a new worktree and session after a refused resume', async () => {
  const f = evidence()
  f.previous.failure.reason = 'resume_refused'
  f.previous.failure.exitCode = Number.NaN
  expect(await f.run()).toEqual(fresh('resume_refused'))
})
it('starts a new worktree and session when only the kernel reported the terminal missing', async () => {
  const f = evidence()
  vi.mocked(f.readers.previous).mockReturnValue({
    ...f.previous,
    failure: {
      reason: 'terminal_missing',
      evidence: 'runtime_restarted',
      settlement: { kind: 'interrupted' }
    }
  })
  expect(await f.run()).toEqual(fresh('no_exit_evidence'))
})
it('starts a new worktree and session when the snapshot cannot be continued', async () => {
  const f = evidence()
  expect(await f.run({ kind: 'integration', reason: 'first_attempt' })).toEqual(
    fresh('snapshot_unusable')
  )
  for (const preservation of [
    undefined,
    {},
    {
      taskId: 't',
      baselineSha: 'c'.repeat(40),
      result: { status: 'unavailable', reason: 'git_failure' }
    }
  ]) {
    vi.mocked(f.readers.previous).mockReturnValue({ ...f.previous, preservation })
    expect(await f.run()).toEqual(fresh('snapshot_unusable'))
  }
})
it('starts a new worktree and session when the agent or the account home changed', async () => {
  for (const previous of [
    { ...evidence().agent, provider: 'claude' as const },
    { ...evidence().agent, model: 'other' },
    { ...evidence().agent, reasoning: { effort: 'high' as const } }
  ]) {
    const f = evidence()
    vi.mocked(f.readers.agents).mockReturnValue({ previous, current: f.agent })
    expect(await f.run()).toEqual(fresh('agent_changed'))
    expect(f.readers.version).not.toHaveBeenCalled()
  }
  const f = evidence()
  vi.mocked(f.readers.accounts).mockReturnValue({ previous: '/old-account', current: '/account' })
  expect(await f.run()).toEqual(fresh('account_changed'))
})
it('starts a new worktree and session when the harness version has no resume evidence', async () => {
  const f = evidence()
  vi.mocked(f.readers.version).mockResolvedValue('codex-cli 0.0.0-e2e')
  expect(await f.run()).toEqual(fresh('capability_unproven'))
  expect(f.readers.accounts).not.toHaveBeenCalled()
})
it('starts a new worktree and session when the Task contract changed', async () => {
  for (const current of [
    { ...evidence().manifest, planRevisionId: 'p2' },
    { ...evidence().manifest, mandatory: [] },
    { ...evidence().manifest, mandatory: evidence().manifest.mandatory.toReversed() },
    {
      ...evidence().manifest,
      mandatory: [
        { section: 'Task spec', sha256: 'changed' },
        ...evidence().manifest.mandatory.slice(1)
      ]
    },
    {
      ...evidence().manifest,
      mandatory: [
        ...evidence().manifest.mandatory.slice(0, 2),
        { section: 'Answered questions', sha256: 'changed' }
      ]
    }
  ]) {
    const f = evidence()
    vi.mocked(f.readers.manifests).mockReturnValue({ previous: f.manifest, current })
    expect(await f.run()).toEqual(fresh('contract_changed'))
  }
})
it('ignores only the previous failure evidence hash', async () => {
  const f = evidence()
  vi.mocked(f.readers.manifests).mockReturnValue({
    previous: f.manifest,
    current: {
      ...f.manifest,
      mandatory: f.manifest.mandatory.map((s) =>
        s.section === 'Previous-Attempt failure evidence' ? { ...s, sha256: 'changed' } : s
      )
    }
  })
  expect(await f.run()).toMatchObject({ strategy: 'resumed_in_place' })
})
it('rejects an unknown session or a resumed predecessor reporting another thread', async () => {
  const f = evidence()
  f.previous.failure.providerSessionId = '../unsafe'
  expect(await f.run()).toEqual(fresh('session_unknown'))
  vi.mocked(f.readers.thread).mockResolvedValue('thread-2')
  vi.mocked(f.readers.previous).mockReturnValue({
    ...f.previous,
    session: { strategy: 'resumed_in_place', id: 'thread-1', originSeq: 1, fromSeq: 1 }
  })
  expect(await f.run()).toEqual(fresh('session_unknown'))
})
it('starts a new worktree and session when the session record is gone', async () => {
  const f = evidence()
  vi.mocked(f.readers.recordExists).mockResolvedValue(false)
  expect(await f.run()).toEqual(fresh('session_record_missing'))
  expect(f.readers.worktree).not.toHaveBeenCalled()
})
it('starts a new worktree and session when the worktree no longer equals the snapshot', async () => {
  const f = evidence()
  vi.mocked(f.readers.worktree).mockResolvedValue(undefined)
  expect(await f.run()).toEqual(fresh('worktree_changed'))
})
it('contains an error from every adapter as evidence_unreadable', async () => {
  for (const key of Object.keys(evidence().readers)) {
    const f = evidence()
    f.previous.failure.providerSessionId = ''
    vi.mocked(f.readers.thread).mockResolvedValue('thread-1')
    for (const [name, reader] of Object.entries(f.readers)) {
      if (name === key) {
        vi.mocked(reader).mockImplementation(() => {
          throw new Error('private evidence')
        })
      }
    }
    expect(await f.run()).toEqual(fresh('evidence_unreadable'))
  }
})

it('chooses the first failing rule for every ordered pair of failures', async () => {
  type Fixture = ReturnType<typeof evidence>
  const failures: [string, (f: Fixture) => void][] = [
    [
      'not_interrupted',
      (f) => {
        f.previous.stopped = true
      }
    ],
    [
      'resume_refused',
      (f) => {
        f.previous.failure.reason = 'resume_refused'
      }
    ],
    [
      'no_exit_evidence',
      (f) => {
        f.previous.failure.exitCode = 1.5
      }
    ],
    [
      'snapshot_unusable',
      (f) => {
        vi.mocked(f.readers.previous).mockImplementation(() => ({
          ...f.previous,
          preservation: undefined
        }))
      }
    ],
    [
      'agent_changed',
      (f) => {
        vi.mocked(f.readers.agents).mockReturnValue({
          current: f.agent,
          previous: { ...f.agent, model: 'changed' }
        })
      }
    ],
    [
      'capability_unproven',
      (f) => {
        vi.mocked(f.readers.version).mockResolvedValue('codex-cli other')
      }
    ],
    [
      'account_changed',
      (f) => {
        vi.mocked(f.readers.accounts).mockReturnValue({ current: '/new', previous: '/old' })
      }
    ],
    [
      'contract_changed',
      (f) => {
        vi.mocked(f.readers.manifests).mockReturnValue({
          current: { ...f.manifest, planRevisionId: 'changed' },
          previous: f.manifest
        })
      }
    ],
    [
      'session_unknown',
      (f) => {
        f.previous.failure.providerSessionId = ''
      }
    ],
    [
      'session_record_missing',
      (f) => {
        vi.mocked(f.readers.recordExists).mockResolvedValue(false)
      }
    ],
    [
      'worktree_changed',
      (f) => {
        vi.mocked(f.readers.worktree).mockResolvedValue(undefined)
      }
    ]
  ]
  for (const [index, [reason, fail]] of failures.entries()) {
    for (const [, later] of failures.slice(index + 1)) {
      const f = evidence()
      fail(f)
      later(f)
      expect(await f.run()).toEqual(fresh(reason))
    }
  }
})

it('contains missing required evidence without exposing it in the decision', async () => {
  for (const incomplete of ['agent', 'account', 'manifest', 'origin']) {
    const f = evidence()
    if (incomplete === 'agent') {
      vi.mocked(f.readers.agents).mockReturnValue({ current: f.agent, previous: undefined })
    }
    if (incomplete === 'account') {
      vi.mocked(f.readers.accounts).mockReturnValue({ current: null, previous: '/private' })
    }
    if (incomplete === 'manifest') {
      vi.mocked(f.readers.manifests).mockReturnValue({ current: f.manifest, previous: undefined })
    }
    if (incomplete === 'origin') {
      vi.mocked(f.readers.originStartedAt).mockReturnValue(Number.NaN)
    }
    expect(await f.run()).toEqual(fresh('evidence_unreadable'))
  }
})
