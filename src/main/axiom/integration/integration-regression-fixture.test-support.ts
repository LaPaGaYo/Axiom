import { afterEach, beforeEach, expect, vi } from 'vitest'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { integrationFixture, type IntegrationFixture } from './integration-fixture.test-support'

export function regressionFixtures() {
  let root: string
  const fixtures: IntegrationFixture[] = []
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'axiom-regression-')))
  })
  afterEach(async () => {
    for (const f of fixtures.splice(0)) {
      await f.effects.stop()
      f.db.close()
    }
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })
  return async () => {
    const directory = path.join(root, `case-${fixtures.length}`)
    await mkdir(directory)
    const f = await integrationFixture(directory)
    fixtures.push(f)
    return f
  }
}

export function regressionCommands(
  f: IntegrationFixture,
  commands: string[] = ['node -e ""'],
  verificationRules = {}
) {
  const spec = {
    ...f.task.spec,
    requiredEvidence: undefined,
    acceptanceCriteria: commands.map((command) => ({
      text: `Command passes: ${command}`,
      check: { kind: 'command', command }
    }))
  }
  f.db.db
    .prepare('UPDATE task_stages SET spec = ? WHERE task_id = ?')
    .run(JSON.stringify(spec), f.task.taskId)
  f.store.upsertPolicy(f.missionId, { ...f.store.getPolicy(f.missionId)!, verificationRules })
}

export const batchRuns = (f: IntegrationFixture) =>
  f.store.listVerificationRuns({
    missionId: f.missionId,
    batchId: f.batches()[0]?.id ?? 'absent'
  })

export async function dueAgain(f: IntegrationFixture) {
  await f.effects.stop()
  f.db.db
    .prepare('UPDATE axiom_effects SET due_at = ? WHERE id = ?')
    .run(new Date().toISOString(), f.effect()!.id)
}

export async function scratchReturned(f: IntegrationFixture) {
  expect((await f.runtime.listManagedWorktrees()).worktrees).toEqual([])
  expect(await f.git('for-each-ref', 'refs/heads/axiom/integrating')).toBe('')
}

export async function verdictEvidence(f: IntegrationFixture, index = 0) {
  const run = batchRuns(f)[index]
  const saved = await f.artifacts.read(z.string().parse(run.verdictDetail.verdictArtifactId))
  const evidence = z
    .object({
      checks: z.array(z.object({ source: z.string(), stdoutArtifactId: z.string().optional() }))
    })
    .passthrough()
    .parse(JSON.parse(saved.content.toString()))
  return { ...saved, evidence }
}

export async function gateOutput(f: IntegrationFixture) {
  const { evidence } = await verdictEvidence(f, batchRuns(f).length - 1)
  const id = z.string().parse(evidence.checks.find((c) => c.source === 'gate')?.stdoutArtifactId)
  return (await f.artifacts.read(id)).content.toString().trim()
}

export function staleRun(f: IntegrationFixture) {
  const run = f.store.insertVerificationRun({
    id: 'interrupted-regression',
    missionId: f.missionId,
    taskId: f.task.taskId,
    candidateId: f.candidate.id,
    batchId: f.batches()[0].id,
    status: 'QUEUED',
    verdictDetail: {},
    commands: [],
    toolVersions: {},
    verifier: 'IntegrationController'
  })
  return f.store.claimVerificationRun({
    id: run.id,
    runtimeEpoch: 'previous',
    startedAt: new Date().toISOString(),
    verifier: 'IntegrationController'
  })!
}
