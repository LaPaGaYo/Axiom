import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { desktopCall } from './helpers/axiom-desktop-call'
import { MessageListResponseSchema } from '../../src/shared/axiom-contract/message-params'

test('M3-04b-3: report questions hold retries until a human answers; follow-ups remain pending', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(290_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source || process.platform === 'win32') {
    test.skip(true, 'Requires POSIX fixture host')
    return
  }
  const question = 'Should the empty entityId example stay rejected?'
  const answer = 'Yes — keep it rejected.'
  const followUp = 'Add a regression test for leap days'
  const command = `node -e "process.exit(require('node:fs').readFileSync('src/services/date-range.test.ts','utf8').includes('entityId: \\'\\' }, { from') ? 0 : 1)"`
  await withFixtureMission(
    testInfo,
    source,
    async ({ page, userData, mission, ledgerPath, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      const messages = async (pendingOnly = false) =>
        MessageListResponseSchema.parse(
          await desktopCall(page, 'axiom.message.list', { missionId: mission.id, pendingOnly })
        ).messages
      await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
      const taskId = z.string().parse(inspect().bindings[0]?.task_id)
      writeFileSync(`${ledgerPath}.scenario-${taskId}`, 'report-items')
      releaseWorkers()
      await expect
        .poll(() => inspect().verification.map((r) => r.status), { timeout: 60_000 })
        .toEqual(['FAIL'])
      await expect.poll(() => inspect().tasks[0]?.stage, { timeout: 15_000 }).toBe('READY')
      expect(
        inspect()
          .audits.filter((a) => a.event === 'task.stage' && a.object_id === taskId)
          .map((a) => JSON.parse(a.after ?? '{}'))
          .slice(-2)
      ).toMatchObject([{ stage: 'NEEDS_FIX' }, { stage: 'READY' }])
      await page.waitForTimeout(15_000)
      expect(inspect().bindings.map((b) => b.seq)).toEqual([1])
      const first = z.string().parse(inspect().bindings[0]?.dispatch_id)
      const items = await messages(true)
      expect(items).toHaveLength(2)
      const q = items.find((m) => m.type === 'QUESTION')
      const followup = items.find((m) => m.type === 'REQUEST')
      if (!q || !followup) {
        throw new Error('Missing report items')
      }
      expect(q).toMatchObject({
        taskId,
        attemptId: first,
        question,
        options: [],
        status: 'pending',
        pending: true
      })
      expect(followup).toMatchObject({
        taskId,
        attemptId: first,
        followUp: { text: followUp },
        pending: true
      })
      const params = { missionId: mission.id, questionId: q.id }
      await expect(
        desktopCall(page, 'axiom.message.answer', { ...params, body: `ghp_${'T'.repeat(36)}` })
      ).rejects.toMatchObject({ code: 'invalid_argument', message: 'secret_in_answer' })
      expect(inspect().audits.filter((a) => a.event === 'question.answered')).toEqual([])
      expect(await messages(true)).toEqual(items)
      await desktopCall(page, 'axiom.message.answer', { ...params, body: answer })
      expect((await messages()).find((m) => m.id === q.id)).toMatchObject({
        pending: false,
        status: 'answered',
        answer
      })
      expect((await messages(true)).map((m) => m.id)).toEqual([followup.id])
      await expect
        .poll(() => inspect().bindings.find((b) => b.seq === 2)?.dispatch_id, { timeout: 60_000 })
        .toBeTruthy()
      const second = z.string().parse(inspect().bindings.find((b) => b.seq === 2)?.dispatch_id)
      const promptPath = path.join(userData, 'axiom', 'attempts', second, 'prompt.md')
      await expect.poll(() => existsSync(promptPath)).toBe(true)
      const prompt = readFileSync(promptPath, 'utf8')
      expect(prompt).toContain('## Answered questions')
      expect(prompt).toContain(
        `Q (Attempt 1): ${JSON.stringify(question)} — A: ${JSON.stringify(answer)}`
      )
      await expect.poll(() => inspect().tasks[0]?.stage, { timeout: 60_000 }).toBe('VERIFIED')
      expect(
        inspect()
          .verification.map((r) => r.status)
          .sort()
      ).toEqual(['FAIL', 'PASS'])
      expect((await messages(true)).map((m) => m.id)).toEqual([followup.id])
      await desktopCall(page, 'axiom.message.resolve', {
        missionId: mission.id,
        messageId: followup.id,
        decision: 'reject',
        rationale: 'Outside this Mission; keep the existing scope.'
      })
      expect(inspect().audits.filter((a) => a.event === 'followup.resolved')).toEqual([
        expect.objectContaining({ object_id: followup.id })
      ])
      expect(await messages(true)).toEqual([])
      expect(inspect().bindings.map((b) => b.seq)).toEqual([1, 2])
    },
    {
      taskIds: ['T01'],
      maxAttempts: 3,
      holdWorkers: true,
      runVerification: true,
      extraAllowedPaths: ['src/services/date-range.ts', 'src/services/date-range.test.ts'],
      acceptanceCriteria: [
        {
          text: 'The date-range contract rejects an empty entityId',
          check: { kind: 'command', command }
        }
      ]
    }
  )
})
