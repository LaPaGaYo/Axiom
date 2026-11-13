import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { readVerdictRecord } from '../../../shared/axiom-contract/verdict-record'
import { verificationGitFixture } from './verification-fixture.test-support'
import { VerificationService } from './verification-service'

it('reads the checks and criteria a real verification verdict wrote', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'axiom-verdict-reader-'))
  const f = await verificationGitFixture(root)
  const service = new VerificationService({
    store: f.store,
    missions: f.controller,
    artifacts: f.artifacts,
    runtime: f.runtime,
    runtimeEpoch: 'reader-test'
  })
  try {
    const command = `node -e "console.error(' FAIL src/a.test.ts > broken');process.exit(1)"`
    f.store.updateTaskSpec({
      taskId: f.task.taskId,
      expectedStage: 'SUBMITTED',
      retryPolicy: f.task.retryPolicy,
      spec: {
        ...f.task.spec,
        requiredEvidence: undefined,
        acceptanceCriteria: [
          { text: 'The command passes', check: { kind: 'command', command } },
          { text: 'The example is clear', check: { kind: 'human' } }
        ]
      }
    })
    f.store.upsertPolicy(f.missionId, { ...f.store.getPolicy(f.missionId)!, verificationRules: {} })
    await service.kick()
    const row = f.store.getVerificationRun(f.run.id)!
    const record = readVerdictRecord(row.verdictDetail)
    expect(row.status).toBe('FAIL')
    expect(record).toMatchObject({ verdict: 'FAIL', reason: 'checks_failed', phase: 'verdict' })
    expect(record.checks).toMatchObject([
      {
        index: 0,
        source: 'evidence',
        command,
        result: 'fail',
        exitCode: 1,
        failures: ['src/a.test.ts > broken']
      }
    ])
    expect(record.acceptance).toMatchObject([
      { index: 0, text: 'The command passes', result: 'fail', checkIndexes: [0] },
      { index: 1, text: 'The example is clear', result: 'human' }
    ])
    expect(record.checks[0].excerpt).toBeUndefined()
    expect(record.verdictArtifactId).toEqual(expect.any(String))
    const artifact = await f.artifacts.read(record.verdictArtifactId!)
    const evidence = readVerdictRecord(JSON.parse(artifact.content.toString('utf8')))
    expect(evidence.verdict).toBe(record.verdict)
    expect(evidence.acceptance).toEqual(record.acceptance)
    expect(evidence.checks[0]).toMatchObject(record.checks[0])
    expect(evidence.checks[0].excerpt).toContain('FAIL src/a.test.ts > broken')
  } finally {
    await service.stop()
    f.db.close()
    await rm(root, { recursive: true, force: true })
  }
})
