import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { cli, invoke, withFixtureMission } from './helpers/axiom-fixture-mission'
import { desktopCall } from './helpers/axiom-desktop-call'
import { fixtureLedger, inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { ArtifactReadResponseSchema } from '../../src/shared/axiom-contract/artifact-params'
import { PolicyResponseSchema } from '../../src/shared/axiom-contract/policy-params'
import { PlanListResponseSchema } from '../../src/shared/axiom-contract/plan-params'
import { MissionResponseSchema } from '../../src/shared/axiom-contract/mission-params'

test('M3-04c: Worker human actions are refused and desktop policy changes succeed', async (// oxlint-disable-next-line no-empty-pattern -- Fixture helper owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(240_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source) {
    test.skip(true, 'AXIOM_FIXTURE_REPO not set')
    return
  }
  await withFixtureMission(
    testInfo,
    source,
    async ({ page, mission, userData, ledgerPath, temp, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      const plans = () =>
        PlanListResponseSchema.parse(cli(userData, ['plan', 'list', '--mission', mission.id]))
          .planRevisions
      const policy = () =>
        PolicyResponseSchema.parse(
          cli(userData, ['mission', 'policy', 'show', '--mission', mission.id])
        ).policy
      await expect
        .poll(() => inspect().tasks.filter((task) => task.stage === 'RUNNING').length, {
          timeout: 60_000
        })
        .toBe(3)
      const task = inspect().tasks.find(
        (row) => z.object({ id: z.string() }).parse(JSON.parse(row.spec)).id === 'T01'
      )
      if (!task) {
        throw new Error('Missing T01')
      }
      const binding = inspect().bindings.find((row) => row.task_id === task.task_id)
      if (!binding?.dispatch_id) {
        throw new Error('Missing T01 Attempt')
      }
      const attemptId = binding.dispatch_id
      const beforePlans = plans()
      const beforePolicy = policy()
      writeFileSync(`${ledgerPath}.scenario-${task.task_id}`, 'self-approve')
      releaseWorkers()
      await expect
        .poll(() => inspect().submissions.some((row) => row.attemptId === attemptId), {
          timeout: 120_000
        })
        .toBe(true)
      const submission = inspect().submissions.find((row) => row.attemptId === attemptId)
      if (!submission) {
        throw new Error('Missing Worker Submission')
      }
      expect(submission.report.filesChanged).toEqual([])
      const reportId = submission.report.artifacts[0]
      if (!reportId) {
        throw new Error('Missing Worker report Artifact')
      }
      const report = ArtifactReadResponseSchema.parse(
        cli(userData, ['mission', 'artifact', 'read', '--artifact', reportId])
      )
      expect(report.meta.createdBy).toBe(`attempt:${attemptId}`)
      expect(report.meta.related).toEqual([task.task_id, attemptId])
      const text = Buffer.from(report.contentBase64, 'base64').toString('utf8')
      for (const method of ['plan.approve', 'policy.update', 'message.answer']) {
        expect(text).toMatch(
          new RegExp(
            `${method.replace('.', '\\.')} exitCode=[1-9][0-9]* errorCode=caller_not_desktop`
          )
        )
      }
      const refused = inspect().audits.filter(
        (row) => row.event === 'authority.refused' && row.object_id === task.task_id
      )
      expect(refused).toHaveLength(3)
      expect(refused.map((row) => JSON.parse(row.after ?? '{}'))).toEqual(
        expect.arrayContaining([
          { method: 'axiom.plan.approve', callerKind: 'local-cli', attemptId },
          { method: 'axiom.policy.update', callerKind: 'local-cli', attemptId },
          { method: 'axiom.message.answer', callerKind: 'local-cli', attemptId }
        ])
      )
      expect(plans()).toEqual(beforePlans)
      expect(policy()).toEqual(beforePolicy)
      expect(
        MissionResponseSchema.parse(cli(userData, ['mission', 'show', '--mission', mission.id]))
          .mission.status
      ).toBe('EXECUTING')
      // The existing verification hold is at prepared, after SUBMITTED -> VERIFYING.
      expect(
        inspect()
          .audits.filter((row) => row.object_id === task.task_id && row.event === 'task.stage')
          .map((row) => JSON.parse(row.after ?? '{}').stage)
      ).toContain('SUBMITTED')
      const rules = { setupCommands: ['node --version'] }
      const rulesFile = path.join(temp, 'human-verification-rules.json')
      writeFileSync(rulesFile, JSON.stringify(rules))
      const local = invoke(userData, [
        'mission',
        'policy',
        'update',
        '--mission',
        mission.id,
        '--verification-rules-file',
        rulesFile
      ])
      expect(local.status).not.toBe(0)
      expect(JSON.parse(local.stdout)).toMatchObject({
        ok: false,
        error: { code: 'caller_not_desktop' }
      })
      expect(policy()).toEqual(beforePolicy)
      expect(
        PolicyResponseSchema.parse(
          await desktopCall(page, 'axiom.policy.update', {
            missionId: mission.id,
            patch: { verificationRules: rules }
          })
        ).policy.verificationRules
      ).toMatchObject(rules)
      expect(policy().verificationRules).toMatchObject(rules)
      expect(inspect().audits.filter((row) => row.event === 'authority.refused')).toHaveLength(3)
      await expect
        .poll(
          () =>
            fixtureLedger(ledgerPath).filter(
              (entry) => entry.kind === 'submission' && entry.attemptId === attemptId
            ).length
        )
        .toBe(1)
      expect(fixtureLedger(ledgerPath).filter((entry) => entry.kind === 'error')).toEqual([])
    },
    { holdWorkers: true, maxAttempts: 1 }
  )
})
