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

it('consumes a Task crash marker before the stub, exits without submitting, then retries normally', async () => {
  const files = new Set(['/ledger.crash-task-1'])
  const events: string[] = []
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
      stdout: JSON.stringify({ ok: true, result: { artifact: { id: 'art_report' } } })
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
          writeFileSync() {}
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
    '1',
    '--mode',
    'succeed',
    '--cwd',
    '/fixture'
  ])
  expect(
    spawnSync.mock.calls.some((call) => call[1][1] === 'attempt' && call[1][2] === 'submit')
  ).toBe(true)
  expect(exit).toHaveBeenCalledTimes(1)
})

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

it.each(['scope-violation', 'secret-line'])(
  'keeps the %s provider-only report outside the Candidate',
  async (scenario) => {
    const files = new Map([['/ledger.scenario-task-1', scenario]])
    const written = new Map<string, string>()
    const removed: string[] = []
    const spawnSync = vi.fn((command: string, args: string[]) => {
      expect(args.includes('scenarios/stub-worker/worker.mjs')).toBe(false)
      if (command === 'git') {
        return {
          status: 0,
          stdout: scenario === 'scope-violation' ? 'README.md\n' : 'src/services/csv.ts\n'
        }
      }
      if (args.includes('artifact')) {
        expect(args[args.indexOf('--file') + 1]).toBe('/virtual-report/REPORT.md')
      }
      return {
        status: 0,
        stdout: JSON.stringify({ ok: true, result: { artifact: { id: 'art_report' } } })
      }
    })
    const nativeRequire = createRequire(import.meta.url)
    await runInNewContext(
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
              rmSync: (file: string) => removed.push(file)
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
          stdout: { write() {} },
          stdin: { setEncoding() {}, on() {}, resume() {} }
        },
        setInterval() {}
      }
    )
    expect(written.get('/virtual-report/REPORT.md')).toContain('taskId: task-1')
    const report = JSON.parse(written.get('/virtual-report/report.json')!)
    expect(report.filesChanged).toEqual([
      scenario === 'scope-violation' ? 'README.md' : 'src/services/csv.ts'
    ])
    expect(removed).toContain('/virtual-report')
    expect(files.has('/fixture/REPORT.md')).toBe(false)
    expect(written.has('/fixture/REPORT.md')).toBe(false)
    if (scenario === 'secret-line') {
      expect(files.get('/fixture/src/services/csv.ts')).toContain(`${'gh' + 'p_'}${'Z'.repeat(36)}`)
    } else {
      expect(files.get('/fixture/README.md')).toBe('\n<!-- axiom e2e scope probe -->\n')
    }
  }
)
