import { vi } from 'vitest'
import { getAxiomControlPlane } from '../control-plane'
import { z } from 'zod'
import * as snapshots from './candidate-snapshot'
import { channelFixture } from './attempt-channel-fixture.test-support'
import type { SubmissionReport } from '../../../shared/axiom-contract/submission-params'
import * as output from '../../runtime/orchestration/worker-output-archive'
import * as release from '../../runtime/rpc/methods/orchestration/worker/local-worker-release'
import { sha256 } from '../artifacts/artifact-store'

export const report: SubmissionReport = {
  summary: 'Implemented Task changes',
  filesChanged: ['src/file.ts'],
  checksRun: [{ command: 'pnpm test', result: 'pass', durationMs: 7 }],
  artifacts: [],
  limitations: ['Write scope is verified in M3'],
  risks: [],
  questions: [],
  followUps: ['Independent verification']
}
export function submissionFixture() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const f = channelFixture()
  const kick = vi
    .spyOn(getAxiomControlPlane(f.runtime).verification, 'kick')
    .mockImplementation(async () => {
      if (f.db.db.isTransaction) {
        throw new Error('Verification triggered inside submission transaction')
      }
    })
  f.db.getOrCreateLocalMutationCallerFingerprint()
  const snapshotGit = vi.spyOn(snapshots, 'snapshotCandidate').mockResolvedValue({
    commitSha: 'a'.repeat(40),
    treeSha: 'b'.repeat(40),
    snapshotCommitted: true
  })
  const capture = vi.spyOn(output, 'captureWorkerOutputArchive').mockResolvedValue({
    kind: 'terminal_tail',
    status: 'captured',
    content: { lines: ['Worker output'], truncated: false, terminalStatus: 'running', warnings: [] }
  })
  const put = vi
    .spyOn(getAxiomControlPlane(f.runtime).artifacts, 'put')
    .mockImplementation(async (input) =>
      f.store.insertArtifact({
        ...input,
        id: `art_${sha256(input.content)}`,
        sha256: sha256(input.content),
        sizeBytes: input.content.length
      })
    )
  vi.spyOn(f.runtime, 'inspectTerminalProcess').mockResolvedValue({
    foregroundProcess: null,
    hasChildProcesses: false
  })
  const releaseWorker = vi
    .spyOn(release, 'releaseLocalWorker')
    .mockImplementation(async (_runtime, dispatchId) => ({
      dispatchId,
      state: 'released',
      processAction: 'closed_agent_terminal',
      archive: { source: 'terminal', status: 'captured' }
    }))
  const params = (worker = f.t01) => ({ attemptId: worker.attemptId, from: worker.from, report })
  const submit = (worker = f.t01) => f.call('axiom.attempt.submit', params(worker))
  const tables = z
    .array(z.object({ name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/) }))
    .parse(
      f.db.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('mutation_receipts', 'mutation_receipt_ledger') ORDER BY name"
        )
        .all()
    )
  const snapshot = () =>
    tables.map(({ name }) => ({
      name,
      rows: f.db.db.prepare(`SELECT * FROM "${name}"`).all()
    }))
  return { ...f, kick, snapshotGit, capture, put, releaseWorker, params, submit, snapshot }
}
