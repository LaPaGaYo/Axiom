import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { desktopCall } from './helpers/axiom-desktop-call'
import { cli, withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import type { AcceptanceCriterion } from '../../src/shared/axiom-contract/mission-objects'
import { VerificationListResponseSchema } from '../../src/shared/axiom-contract/verification-params'
import { RuntimeRpcEnvelopeSchema } from '../../src/shared/runtime-rpc-envelope'

const source = process.env.AXIOM_FIXTURE_REPO
const passing: AcceptanceCriterion = {
  text: 'The date-range examples include entityId',
  check: {
    kind: 'command',
    command: `node -e "process.exit(require('node:fs').readFileSync('src/services/date-range.test.ts','utf8').includes('entityId') ? 0 : 1)"`
  }
}
const human: AcceptanceCriterion = {
  text: 'A person confirms the example is clear',
  check: { kind: 'human' }
}
const rationale = 'The example must mention leap days.'

for (const scenario of [
  'resolve PASS',
  'resolve FAIL',
  'deterministic final',
  'adjust and rerun'
] as const) {
  test(`M3-05: ${scenario}`, async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the hidden background app lifecycle.
  {}, testInfo) => {
    test.setTimeout(295_000)
    if (!source || process.platform === 'win32') {
      test.skip(true, 'Requires a POSIX fixture host')
      return
    }
    const acceptanceCriteria: AcceptanceCriterion[] =
      scenario === 'adjust and rerun'
        ? [
            {
              text: 'The requested script passes',
              check: { kind: 'command', command: 'pnpm run no-such-script' }
            }
          ]
        : [
            passing,
            scenario === 'deterministic final'
              ? {
                  text: 'The second check passes',
                  check: { kind: 'command', command: 'node -e "process.exit(1)"' }
                }
              : human
          ]
    await withFixtureMission(
      testInfo,
      source,
      async ({ page, userData, mission, ledgerPath, releaseWorkers }) => {
        const inspect = () => inspectFixtureMission(userData, mission.id)
        await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
        const taskId = z.string().parse(inspect().bindings[0]?.task_id)
        writeFileSync(`${ledgerPath}.scenario-${taskId}`, 'agent-crash')
        if (scenario === 'deterministic final') {
          // Keep the failed Task READY so refusal is checked before any next admission.
          await desktopCall(page, 'axiom.policy.update', {
            missionId: mission.id,
            patch: {
              routing: { disallowedProviders: ['codex', 'claude', 'opencode', 'antigravity'] }
            }
          })
        }
        releaseWorkers()
        await expect
          .poll(() => inspect().verification[0]?.status, { timeout: 90_000 })
          .toBe(scenario === 'deterministic final' ? 'FAIL' : 'HUMAN_REVIEW')
        const run = inspect().verification[0]
        if (!run) {
          throw new Error('Missing verification run')
        }
        if (scenario === 'deterministic final') {
          await expect.poll(() => inspect().tasks[0]?.stage).toBe('READY')
          await expect
            .poll(
              () => inspect().verification.find((row) => row.id === run.id)?.worktreeId === null
            )
            .toBe(true)
          const before = inspect()
          for (const [method, params, reason] of [
            [
              'axiom.verification.resolve',
              { runId: run.id, verdict: 'PASS', rationale: 'Try to override' },
              'deterministic_verdict_final'
            ],
            [
              'axiom.verification.rerun',
              { taskId, rationale: 'Try to rerun a READY Task' },
              'task_not_rerunnable'
            ]
          ] as const) {
            const result = RuntimeRpcEnvelopeSchema.parse(
              await page.evaluate((request) => window.api.runtime.call(request), {
                method,
                params,
                envelope: { orchestrationContractVersion: 1, orchestrationRequestId: randomUUID() }
              })
            )
            expect(result).toMatchObject({
              ok: false,
              error: { code: 'illegal_transition', data: { reason } }
            })
          }
          expect(inspect().verification).toEqual(before.verification)
          expect(inspect().tasks).toEqual(before.tasks)
          expect(
            inspect().audits.filter((audit) => audit.event === 'verification.resolved')
          ).toEqual([])
          expect(inspect().bindings.map((binding) => binding.seq)).toEqual([1])
          return
        }
        expect(inspect().tasks[0]?.stage).toBe('VERIFYING')
        expect(run.verdictDetail).toMatchObject({
          verdict: 'INCONCLUSIVE',
          reason: scenario === 'adjust and rerun' ? 'plan_invalid' : 'acceptance_human'
        })
        if (scenario === 'adjust and rerun') {
          await desktopCall(page, 'axiom.task.adjust', {
            taskId,
            acceptanceCriteria: [passing],
            rationale: 'The script name was wrong.'
          })
          const rerun = z.object({ runId: z.string(), status: z.literal('QUEUED') }).parse(
            await desktopCall(page, 'axiom.verification.rerun', {
              taskId,
              rationale: 'Recheck the corrected criteria.'
            })
          )
          await expect
            .poll(() => inspect().verification.find((row) => row.id === rerun.runId)?.status, {
              timeout: 90_000
            })
            .toBe('PASS')
          const state = inspect()
          expect(state.verification.find((row) => row.id === run.id)?.status).toBe('CANCELED')
          expect(state.verification.map((row) => row.candidateId)).toEqual([
            run.candidateId,
            run.candidateId
          ])
          expect(state.tasks[0]?.stage).toBe('VERIFIED')
          expect(state.bindings.map((binding) => binding.seq)).toEqual([1])
          return
        }
        const verdict = scenario === 'resolve PASS' ? 'PASS' : 'FAIL'
        if (verdict === 'FAIL') {
          writeFileSync(`${ledgerPath}.hold`, '')
        }
        await desktopCall(page, 'axiom.verification.resolve', {
          runId: run.id,
          verdict,
          rationale,
          criteria: verdict === 'FAIL' ? [1] : []
        })
        expect(inspect().verification.find((row) => row.id === run.id)).toMatchObject({
          status: verdict,
          verdictDetail: {
            resolution: { verdict, rationale, criteria: verdict === 'FAIL' ? [1] : [], by: 'user' }
          }
        })
        expect(
          inspect().audits.find((audit) => audit.event === 'verification.resolved')
        ).toBeDefined()
        expect(
          VerificationListResponseSchema.parse(
            cli(userData, [
              'verification',
              'list',
              '--mission',
              mission.id,
              '--status',
              'HUMAN_REVIEW'
            ])
          ).runs
        ).toEqual([])
        if (verdict === 'PASS') {
          expect(inspect().tasks[0]?.stage).toBe('VERIFIED')
          expect(inspect().bindings.map((binding) => binding.seq)).toEqual([1])
        } else {
          await expect
            .poll(() => inspect().bindings.find((binding) => binding.seq === 2)?.dispatch_id, {
              timeout: 60_000
            })
            .toBeTruthy()
          const attemptId = z
            .string()
            .parse(inspect().bindings.find((binding) => binding.seq === 2)?.dispatch_id)
          const promptPath = path.join(userData, 'axiom', 'attempts', attemptId, 'prompt.md')
          await expect.poll(() => existsSync(promptPath)).toBe(true)
          const prompt = readFileSync(promptPath, 'utf8')
          expect(prompt).toContain('a human judged this failed')
          expect(prompt).toContain(JSON.stringify(rationale))
          const stages = inspect()
            .audits.filter((audit) => audit.event === 'task.stage' && audit.object_id === taskId)
            .map((audit) => JSON.parse(audit.after ?? '{}').stage)
          expect(stages).toContain('NEEDS_FIX')
          expect(stages).toContain('READY')
          expect(inspect().bindings.map((binding) => binding.seq)).toEqual([1, 2])
        }
      },
      {
        taskIds: ['T01'],
        holdWorkers: true,
        runVerification: true,
        maxAttempts: 3,
        acceptanceCriteria
      }
    )
  })
}
