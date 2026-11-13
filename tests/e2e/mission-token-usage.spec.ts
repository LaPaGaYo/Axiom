import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { desktopCall } from './helpers/axiom-desktop-call'
import { MissionUsageResponseSchema } from '../../src/shared/axiom-contract/token-usage'
import {
  AttemptTokenUsageRowSchema,
  AttemptTokenUsageRowCodec
} from '../../src/main/axiom/db/attempt-token-usage-store'
import Database from '../../src/main/sqlite/sync-database'

const source = process.env.AXIOM_FIXTURE_REPO
test.skip(!source || process.platform === 'win32', 'Requires a POSIX host and AXIOM_FIXTURE_REPO')

for (const provider of ['codex', 'claude'] as const) {
  test(`meters the headless ${provider} Worker and exposes final Mission usage`, async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
  {}, testInfo) => {
    test.setTimeout(300_000)
    await withFixtureMission(
      testInfo,
      z.string().parse(source),
      async ({ page, userData, mission, ledgerPath, releaseWorkers }) => {
        const inspect = () => inspectFixtureMission(userData, mission.id)
        await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
        // Task identity exists at admission; dispatch identity is read only after the host Submission exists.
        const taskId = z.string().parse(inspect().bindings[0]?.task_id)
        writeFileSync(`${ledgerPath}.usage-${taskId}`, '')
        releaseWorkers()
        await expect.poll(() => inspect().submissions.length, { timeout: 120_000 }).toBe(1)
        const attemptId = z.string().parse(inspect().submissions[0]?.attemptId)
        const usage = async () =>
          MissionUsageResponseSchema.parse(
            await desktopCall(page, 'axiom.mission.usage', { missionId: mission.id })
          )
        await expect
          .poll(
            async () =>
              (await usage()).tasks
                .find((row) => row.taskId === taskId)
                ?.attempts.find((row) => row.attemptId === attemptId)?.final,
            { timeout: 120_000 }
          )
          .toBe(true)
        const view = await usage()
        const expected =
          provider === 'codex'
            ? {
                newTokens: 1230,
                inputTokens: 3000,
                cachedInputTokens: 1900,
                cacheWriteTokens: 0,
                outputTokens: 130,
                reasoningTokens: 30
              }
            : {
                newTokens: 430,
                inputTokens: 30,
                cachedInputTokens: 2300,
                cacheWriteTokens: 300,
                outputTokens: 100,
                reasoningTokens: 0
              }
        expect(view).toEqual({
          missionId: mission.id,
          limit: null,
          used: expected.newTokens,
          tasks: [
            {
              taskId,
              limit: null,
              used: expected.newTokens,
              attempts: [
                {
                  attemptId,
                  seq: 1,
                  provider,
                  ...expected,
                  status: 'complete',
                  final: true,
                  measuredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
                }
              ]
            }
          ]
        })
        const db = new Database(path.join(userData, 'orchestration.db'), {
          readonly: true,
          fileMustExist: true
        })
        try {
          const rows = db
            .prepare(`SELECT ${Object.keys(AttemptTokenUsageRowSchema.shape).join(', ')}
          FROM attempt_token_usage WHERE mission_id = ? ORDER BY seq`)
            .all(mission.id)
          expect(z.array(AttemptTokenUsageRowCodec).parse(rows)).toEqual([
            { ...view.tasks[0].attempts[0], missionId: mission.id, taskId }
          ])
          const audits = db
            .prepare(
              'SELECT sequence, mission_id, actor, object_kind, object_id, event, before, after, created_at FROM audit_events WHERE mission_id = ?'
            )
            .all(mission.id)
          expect(JSON.stringify({ rows, audits })).not.toContain('USAGE_DECOY_')
        } finally {
          db.close()
        }
      },
      { provider, taskIds: ['T01'], holdWorkers: true }
    )
  })
}
