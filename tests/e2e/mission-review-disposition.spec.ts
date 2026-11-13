import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { desktopCall } from './helpers/axiom-desktop-call'
import { cli, withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { AxiomIdSchema } from '../../src/shared/axiom-contract/mission-objects'
import { PolicyResponseSchema } from '../../src/shared/axiom-contract/policy-params'
import { TaskResponseSchema } from '../../src/shared/axiom-contract/task-params'
import {
  VerificationListResponseSchema,
  VerificationResolveParams,
  VerificationResolutionSchema,
  VerificationResponseSchema
} from '../../src/shared/axiom-contract/verification-params'

test('M3-09-2b-1: a flagged run requires and records a human disposition', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the hidden background app lifecycle.
{}, testInfo) => {
  test.setTimeout(600_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source || process.platform === 'win32') {
    test.skip(true, 'Requires a POSIX fixture host')
    return
  }
  await withFixtureMission(
    testInfo,
    source,
    async ({ page, mission, userData, ledgerPath, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      const list = () =>
        VerificationListResponseSchema.parse(
          cli(userData, ['verification', 'list', '--mission', mission.id])
        ).runs
      await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
      const taskId = AxiomIdSchema.parse(inspect().bindings[0]?.task_id)
      writeFileSync(`${ledgerPath}.scenario-${taskId}`, 'test-skip')
      PolicyResponseSchema.parse(
        await desktopCall(page, 'axiom.policy.update', {
          missionId: mission.id,
          patch: {
            verificationRules: {
              setupCommands: ['pnpm install --frozen-lockfile --prefer-offline']
            }
          }
        })
      )
      releaseWorkers()
      await expect
        .poll(() => list().filter((run) => run.status === 'HUMAN_REVIEW').length, {
          timeout: 480_000
        })
        .toBe(1)
      await expect.poll(() => list().filter((run) => run.worktreeId === null).length).toBe(1)
      const [run] = list()
      if (!run) {
        throw new Error('Missing verification run')
      }
      expect(run).toMatchObject({
        taskId,
        status: 'HUMAN_REVIEW',
        verdictDetail: { verdict: 'INCONCLUSIVE', reason: 'test_tampering' }
      })
      const params = VerificationResolveParams.parse({
        runId: run.id,
        verdict: 'PASS',
        rationale: 'The skipped test is intentional.'
      })
      // desktopCall validates RuntimeRpcEnvelopeSchema before throwing the refusal.
      await expect(desktopCall(page, 'axiom.verification.resolve', params)).rejects.toMatchObject({
        code: 'invalid_argument',
        message: 'disposition_required'
      })
      const pending = VerificationResponseSchema.parse(
        await desktopCall(page, 'axiom.verification.show', { runId: run.id })
      ).run
      expect(pending.status).toBe('HUMAN_REVIEW')
      expect(pending.verdictDetail).toEqual(run.verdictDetail)

      const result = z
        .object({ runId: AxiomIdSchema, status: VerificationResolveParams.shape.verdict })
        .parse(
          await desktopCall(page, 'axiom.verification.resolve', {
            ...params,
            disposition: 'intentional'
          })
        )
      expect(result).toEqual({ runId: run.id, status: 'PASS' })
      const resolved = VerificationResponseSchema.parse(
        await desktopCall(page, 'axiom.verification.show', { runId: run.id })
      ).run
      expect(resolved.status).toBe('PASS')
      expect(resolved.verdictDetail).toMatchObject({
        verdict: 'INCONCLUSIVE',
        reason: 'test_tampering'
      })
      expect(VerificationResolutionSchema.parse(resolved.verdictDetail.resolution)).toEqual({
        verdict: 'PASS',
        rationale: params.rationale,
        criteria: [],
        disposition: 'intentional',
        by: 'user',
        at: expect.any(String)
      })
      const task = TaskResponseSchema.parse(
        await desktopCall(page, 'axiom.task.show', { taskId })
      ).task
      expect(task.stage).toBe('VERIFIED')
      const audits = inspect().audits.filter(
        (audit) => audit.object_id === run.id && audit.event === 'verification.resolved'
      )
      expect(audits).toHaveLength(1)
      const audit = VerificationResolutionSchema.omit({ at: true })
        .extend({ taskId: AxiomIdSchema, candidateId: AxiomIdSchema })
        .parse(JSON.parse(audits[0].after ?? '{}'))
      expect(audit).toEqual({
        verdict: 'PASS',
        rationale: params.rationale,
        criteria: [],
        disposition: 'intentional',
        taskId,
        candidateId: run.candidateId,
        by: 'user'
      })
    },
    {
      taskIds: ['T01'],
      holdWorkers: true,
      runVerification: true,
      maxAttempts: 1,
      extraAllowedPaths: ['src/domain/date.test.ts']
    }
  )
})
