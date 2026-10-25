import { describe, expect, it, vi } from 'vitest'
import { decomposition } from '../../../src/shared/axiom-contract/contract-fixtures.test-support'
import {
  PlanProposalSchema,
  validatePlanProposal
} from '../../../src/shared/axiom-contract/plan-proposal'
import { fixturePlanProposal } from './fixture-plan-proposal'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { AXIOM_TEST_PROVIDER_SOURCE } from './axiom-test-provider'

const at = '2026-10-17T12:00:00Z'

it.each([1, 2, 3])(
  'consumes a Task crash marker before the stub, then passes seq %i to the stub',
  async (seq) => {
    const files = new Set(['/ledger.crash-task-1'])
    const events: string[] = []
    const written = new Map<string, string>()
    const spawnSync = vi.fn((_command: string, args: string[]) => {
      if (args.includes('--mode')) {
        expect(files.has('/ledger.crash-task-1')).toBe(false)
        return { status: args.includes('crash') ? 137 : 0 }
      }
      if (args[0] === 'diff') {
        return { status: 0, stdout: 'src/retry.ts\n' }
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          result: {
            attempt: { seq },
            artifact: { id: 'art_report' },
            planRevisions: [{ id: 'plan-1', status: 'APPROVED' }]
          }
        })
      }
    })
    const exit = vi.fn((code: number) => {
      throw new Error(`provider exit ${code}`)
    })
    const nativeRequire = createRequire(import.meta.url)
    const context = {
      require: (name: string) => {
        if (name === 'node:path') {
          return nativeRequire('node:path').posix
        }
        if (name === 'node:fs') {
          return {
            existsSync: (file: string) => files.has(file),
            readFileSync: (file: string) => {
              expect(file).toBe('/fixture/REPORT.md')
              return 'Frozen stub report'
            },
            rmSync: (file: string) => files.delete(file),
            appendFileSync: (_file: string, body: string) => events.push(body),
            mkdtempSync: () => '/virtual-report',
            writeFileSync: (file: string, content: string) => written.set(file, content)
          }
        }
        if (name === 'node:child_process') {
          return { spawnSync }
        }
        return nativeRequire(name)
      },
      process: {
        argv: [],
        env: { AXIOM_E2E_LEDGER: '/ledger', ORCA_E2E_CLI_ENTRY: '/cli' },
        execPath: '/node',
        cwd: () => '/fixture',
        exit,
        stdout: { write() {} },
        stdin: { setEncoding() {}, on() {}, resume() {} }
      },
      setInterval() {}
    }
    await expect(
      runInNewContext(
        `${AXIOM_TEST_PROVIDER_SOURCE}
submitFixture('attempt-1', 'mission-1', 'task-1')`,
        context
      )
    ).rejects.toThrow('provider exit 137')
    expect(exit).toHaveBeenCalledWith(137)
    expect(events).toEqual([
      `${JSON.stringify({ kind: 'crash', attemptId: 'attempt-1', taskId: 'task-1' })}\n`
    ])
    expect(spawnSync.mock.calls.map((call) => call[1])).toEqual([
      ['/cli', 'attempt', 'show', '--attempt', 'attempt-1', '--json'],
      [
        'scenarios/stub-worker/worker.mjs',
        '--scenario',
        'agent-crash',
        '--mode',
        'crash',
        '--cwd',
        '/fixture'
      ]
    ])
    spawnSync.mockClear()
    await runInNewContext(
      `${AXIOM_TEST_PROVIDER_SOURCE}
submitFixture('attempt-2', 'mission-1', 'task-1')`,
      { ...context }
    )
    expect(spawnSync.mock.calls[1]![1]).toEqual([
      'scenarios/stub-worker/worker.mjs',
      '--scenario',
      'retry',
      '--attempt',
      String(Math.min(seq, 2)),
      '--mode',
      'succeed',
      '--cwd',
      '/fixture'
    ])
    expect(
      spawnSync.mock.calls.some((call) => call[1][1] === 'attempt' && call[1][2] === 'submit')
    ).toBe(true)
    expect(exit).toHaveBeenCalledTimes(1)
    expect(JSON.parse(written.get('/virtual-report/report.json')!).summary).toBe(
      `D49 retry scenario attempt ${seq} succeeded`
    )
  }
)

function fixtureInput() {
  return {
    goalId: 'goal-sprints-v1',
    referenceOnly: true,
    tasks: decomposition.map(({ files, ...task }) => ({
      ...task,
      scope: files,
      acceptance: [{ command: 'pnpm run verify:full', must: `${task.id} acceptance passes` }],
      parallelReady: task.dependsOn.length === 0,
      estimatedSize: 'small'
    }))
  }
}

describe('fixture-v1 PlanProposal conversion', () => {
  it('keeps the executable D49 planner conversion identical to the fixture mapping', () => {
    const input = fixtureInput()
    const result: unknown = runInNewContext(
      `${AXIOM_TEST_PROVIDER_SOURCE}\nfixtureProposal(input.tasks, 'goal-1')`,
      {
        input,
        require: createRequire(import.meta.url),
        process: {
          argv: [],
          stdout: { write() {} },
          stdin: { setEncoding() {}, on() {}, resume() {} }
        },
        setInterval() {}
      }
    )
    const { provenance: _provenance, ...expected } = fixturePlanProposal(input, 'goal-1', at)
    expect(JSON.parse(JSON.stringify(result))).toEqual(expected)
  })
  it('preserves twelve Tasks, twenty edges and the three expected READY roots', () => {
    const input = fixtureInput()
    const proposal = fixturePlanProposal(input, 'active-goal-1', at)
    expect(PlanProposalSchema.safeParse(proposal).success).toBe(true)
    expect(validatePlanProposal(proposal)).toMatchObject({ ok: true })
    expect(proposal.tasks).toHaveLength(12)
    expect(proposal.edges).toHaveLength(20)
    const incoming = new Set(proposal.edges.map((edge) => edge.toTaskId))
    const readyRoots = proposal.tasks.filter((task) => !incoming.has(task.id))
    expect(readyRoots.map((task) => task.id).sort()).toEqual(['T01', 'T02', 'T03'])
    expect(proposal.goalRevisionId).toBe('active-goal-1')
    expect(proposal.provenance).toEqual({ kind: 'user', actor: 'e2e', at })
    expect(proposal.milestones).toEqual([
      { id: 'm1', title: 'M1 exit', exitCriteria: ['all 12 Tasks integrated'] }
    ])
    expect(proposal.risks).toEqual([])
    expect(proposal.tasks).toEqual(
      input.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        objective: task.title,
        scope: { allowedPaths: task.scope },
        acceptanceCriteria: task.acceptance.map((entry) => entry.must),
        requiredEvidence: ['pnpm run verify:full'],
        risk: 'low',
        retryPolicy: { maxAttempts: 2 },
        kind: 'task',
        milestoneId: 'm1'
      }))
    )
    expect(proposal.edges).toEqual(
      input.tasks.flatMap((task) =>
        task.dependsOn.map((dep) => ({
          fromTaskId: dep,
          toTaskId: task.id,
          readinessThreshold: 'INTEGRATED'
        }))
      )
    )
  })

  it('deduplicates evidence commands while retaining each acceptance criterion', () => {
    const input = fixtureInput()
    input.tasks[0].acceptance.push({ command: 'pnpm run verify:full', must: 'Second criterion' })
    const task = fixturePlanProposal(input, 'goal-1', at).tasks[0]
    expect(task.requiredEvidence).toEqual(['pnpm run verify:full'])
    expect(task.acceptanceCriteria).toEqual(['T01 acceptance passes', 'Second criterion'])
  })

  it('rejects malformed input and a cyclic converted graph before a file can be written', () => {
    expect(() => fixturePlanProposal({ tasks: [] }, 'goal-1', at)).toThrow()
    const input = fixtureInput()
    input.tasks[0].dependsOn.push('T04')
    expect(() => fixturePlanProposal(input, 'goal-1', at)).toThrow(/cycle/)
  })
})

const tamperScenarios = [
  {
    scenario: 'test-skip',
    file: 'src/domain/date.test.ts',
    before: "import { test } from 'vitest'\ntest('extended years are valid', () => {})\n",
    after: "import { test } from 'vitest'\ntest.skip('extended years are valid', () => {})\n"
  },
  {
    scenario: 'assertion-drop',
    file: 'src/domain/guards.test.ts',
    before:
      'test("guards", () => {\n  expect(strings([1])).toBe(false)\n  expect(strings([])).toBe(true)\n})\n',
    after: 'test("guards", () => {\n  expect(strings([])).toBe(true)\n})\n'
  },
  {
    scenario: 'suppression',
    file: 'src/domain/clock.test.ts',
    before:
      "test('fixed clocks normalize instants and reject malformed input', () => {\n  expect(true).toBe(true)\n})\n",
    after:
      "test('fixed clocks normalize instants and reject malformed input', () => {\n  expect(true).toBe(true)\n})\n/* c8 ignore next */\n"
  }
]
it.each([
  ...[
    'scope-violation',
    'self-approve',
    'secret-line',
    'transcript-secret',
    ...tamperScenarios.map(({ scenario }) => scenario)
  ].flatMap((scenario) => [1, 2, 3].map((seq) => ({ scenario, seq, missing: false }))),
  ...tamperScenarios.map(({ scenario }) => ({ scenario, seq: 1, missing: true }))
])(
  'keeps the $scenario report outside the Candidate at seq $seq (missing text: $missing)',
  async ({ scenario, seq, missing }) => {
    const files = new Map([['/ledger.scenario-task-1', scenario]])
    const tamper = tamperScenarios.find((entry) => entry.scenario === scenario)
    if (tamper) {
      files.set(`/fixture/${tamper.file}`, missing ? 'fixture drift\n' : tamper.before)
    }
    const stdout = vi.fn()
    if (scenario === 'transcript-secret') {
      files.set('/fixture/REPORT.md', 'Frozen retry report')
    }
    const written = new Map<string, string>()
    const removed: string[] = []
    const spawnSync = vi.fn((command: string, args: string[]) => {
      if (args.includes('scenarios/stub-worker/worker.mjs')) {
        expect(scenario).toBe('transcript-secret')
        expect(args).toEqual([
          'scenarios/stub-worker/worker.mjs',
          '--scenario',
          'retry',
          '--attempt',
          String(Math.min(seq, 2)),
          '--mode',
          'succeed',
          '--cwd',
          '/fixture'
        ])
        expect(stdout.mock.calls.flat().join('')).toContain(`${'gh' + 'p_'}${'T'.repeat(36)}`)
        return { status: 0, stdout: '' }
      }
      if (args.includes('approve') || args.includes('update') || args.includes('answer')) {
        expect(scenario).toBe('self-approve')
        return {
          status: 1,
          stdout: JSON.stringify({ ok: false, error: { code: 'caller_not_desktop' } })
        }
      }
      if (command === 'git') {
        return {
          status: 0,
          stdout:
            scenario === 'self-approve'
              ? ''
              : scenario === 'scope-violation'
                ? 'README.md\n'
                : scenario === 'secret-line'
                  ? 'src/services/csv.ts\n'
                  : tamper
                    ? `${tamper.file}\n`
                    : 'src/retry.ts\n'
        }
      }
      if (args.includes('artifact')) {
        expect(args[args.indexOf('--file') + 1]).toBe('/virtual-report/REPORT.md')
        expect(args[args.indexOf('--attempt') + 1]).toBe('attempt-1')
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          result: {
            attempt: { seq },
            artifact: { id: 'art_report' },
            planRevisions: [{ id: 'plan-1', status: 'APPROVED' }]
          }
        })
      }
    })
    const nativeRequire = createRequire(import.meta.url)
    const execution = runInNewContext(
      `${AXIOM_TEST_PROVIDER_SOURCE}\nsubmitFixture('attempt-1', 'mission-1', 'task-1')`,
      {
        require: (name: string) => {
          if (name === 'node:path') {
            return nativeRequire('node:path').posix
          }
          if (name === 'node:fs') {
            return {
              existsSync: (file: string) => files.has(file),
              readFileSync: (file: string) => files.get(file),
              writeFileSync: (file: string, content: string) => written.set(file, content),
              appendFileSync: (file: string, content: string) =>
                files.set(file, (files.get(file) ?? '') + content),
              mkdtempSync: () => '/virtual-report',
              rmSync: (file: string) => {
                removed.push(file)
                files.delete(file)
              }
            }
          }
          if (name === 'node:child_process') {
            return { spawnSync }
          }
          return nativeRequire(name)
        },
        process: {
          argv: [],
          env: { AXIOM_E2E_LEDGER: '/ledger', ORCA_E2E_CLI_ENTRY: '/cli' },
          execPath: '/node',
          cwd: () => '/fixture',
          stdout: { write: stdout },
          stdin: { setEncoding() {}, on() {}, resume() {} }
        },
        setInterval() {}
      },
      { filename: 'tests/e2e/helpers/axiom-test-provider.ts' }
    )
    if (missing) {
      await expect(execution).rejects.toThrow(`Missing fixture text: ${scenario}`)
      expect([...written.keys()].filter((file) => file.startsWith('/fixture/'))).toEqual([])
      expect(files.get(`/fixture/${tamper!.file}`)).toBe('fixture drift\n')
      expect(
        spawnSync.mock.calls.some(([, args]) => args.includes('scenarios/stub-worker/worker.mjs'))
      ).toBe(false)
      expect(spawnSync.mock.calls.some(([, args]) => args.includes('submit'))).toBe(false)
      return
    }
    await execution
    expect(written.get('/virtual-report/REPORT.md')).toContain('taskId: task-1')
    const report = JSON.parse(written.get('/virtual-report/report.json')!)
    expect(report.summary).toBe(`D49 ${scenario} scenario attempt ${seq} succeeded`)
    expect(report.filesChanged).toEqual(
      scenario === 'self-approve'
        ? []
        : [
            scenario === 'scope-violation'
              ? 'README.md'
              : scenario === 'secret-line'
                ? 'src/services/csv.ts'
                : tamper
                  ? tamper.file
                  : 'src/retry.ts'
          ]
    )
    expect(removed).toContain('/virtual-report')
    expect(files.has('/fixture/REPORT.md')).toBe(false)
    expect(written.has('/fixture/REPORT.md')).toBe(false)
    if (scenario === 'self-approve') {
      const calls = spawnSync.mock.calls.map(([, args]) => args)
      expect(calls).toContainEqual([
        '/cli',
        'plan',
        'approve',
        '--plan',
        'plan-1',
        '--resolver',
        'worker-self-approve',
        '--json'
      ])
      expect(calls).toContainEqual([
        '/cli',
        'mission',
        'policy',
        'update',
        '--mission',
        'mission-1',
        '--verification-rules-file',
        '/virtual-report/verification-rules.json',
        '--json'
      ])
      expect(calls).toContainEqual([
        '/cli',
        'message',
        'answer',
        '--mission',
        'mission-1',
        '--question',
        'q_does_not_exist',
        '--body',
        'x',
        '--json'
      ])
      expect(calls.some((args) => args.includes('scenarios/stub-worker/worker.mjs'))).toBe(false)
      expect(calls.some((args) => args.includes('submit'))).toBe(true)
      expect(
        written.get('/virtual-report/REPORT.md')?.match(/exitCode=1 errorCode=caller_not_desktop/g)
      ).toHaveLength(3)
      expect(JSON.parse(written.get('/virtual-report/verification-rules.json')!)).toEqual({
        testPathPatterns: []
      })
      expect([...written.keys()].some((file) => file.startsWith('/fixture/'))).toBe(false)
    } else if (tamper) {
      expect(written.get(`/fixture/${tamper.file}`) ?? files.get(`/fixture/${tamper.file}`)).toBe(
        tamper.after
      )
      const touched = [...new Set([...written.keys(), ...files.keys()])].filter((file) =>
        file.startsWith('/fixture/')
      )
      expect(touched).toEqual([`/fixture/${tamper.file}`])
      expect(
        spawnSync.mock.calls.some(([, args]) => args.includes('scenarios/stub-worker/worker.mjs'))
      ).toBe(false)
    } else if (scenario === 'secret-line') {
      const token = `${'gh' + 'p_'}${'Z'.repeat(36)}`
      expect(files.get('/fixture/src/services/csv.ts')).toBe(`// axiom e2e probe ${token}\n`)
    } else if (scenario === 'transcript-secret') {
      expect(written.get('/virtual-report/REPORT.md')).toContain('Frozen retry report')
      expect(JSON.stringify([...written])).not.toContain(`${'gh' + 'p_'}${'T'.repeat(36)}`)
      expect(
        spawnSync.mock.calls.filter(([, args]) => args.includes('scenarios/stub-worker/worker.mjs'))
      ).toHaveLength(1)
    } else {
      expect(files.get('/fixture/README.md')).toBe('\n<!-- axiom e2e scope probe -->\n')
    }
  }
)
