import { expect, it } from 'vitest'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { previousSubmission } from '../execution/attempt-baseline.test-support'
import { resolveAttemptBaseline } from '../execution/attempt-baseline'
import { ArtifactStore } from '../artifacts/artifact-store'
import { humanAcceptance } from '../verification/human-review-fixture.test-support'
import { previousAttemptSection } from './previous-attempt'

it('keeps the human failure lines for the next Attempt when the resolution carries a disposition', async () => {
  const f = planned(fixture())
  try {
    const taskId = f.store.listTaskStages({ missionId: f.missionId })[0].taskId
    const { verificationRun } = previousSubmission(f.store, { missionId: f.missionId, taskId })
    f.store.updateVerificationRun({
      id: verificationRun.id,
      expectedStatus: 'FAIL',
      verdictDetail: {
        verdict: 'INCONCLUSIVE',
        reason: 'acceptance_human',
        acceptance: humanAcceptance,
        resolution: {
          verdict: 'FAIL',
          rationale: 'The example must mention leap days.',
          criteria: [1],
          disposition: 'fixed',
          by: 'user',
          at: '2026-11-13T00:00:00.000Z'
        }
      }
    })
    for (const channel of ['tui', 'headless'] as const) {
      const { content } = await previousAttemptSection(
        f.store,
        new ArtifactStore(f.store, '/unused'),
        resolveAttemptBaseline(f.store, { taskId, seq: 2 }),
        channel
      )
      expect(content).toContain(
        `A human resolved verification run ${verificationRun.id} as FAIL: "The example must mention leap days."`
      )
      expect(content).toContain(
        '[fail] "The example is clear" — a human judged this failed: "The example must mention leap days."'
      )
      expect(content).not.toContain('a person confirms this')
    }
  } finally {
    f.db.close()
  }
})
