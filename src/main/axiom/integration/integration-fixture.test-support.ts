import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gitExecFileAsync } from '../../git/runner'
import { addWorktree } from '../../git/worktree-add'
import { removeWorktree } from '../../git/worktree-removal'
import { listWorktrees } from '../../git/worktree-scan-cache'
import {
  verificationGitFixture,
  verificationRuntime
} from '../verification/verification-fixture.test-support'
import { EffectOutbox } from '../outbox/effect-outbox'
import { registerIntegrationApply } from './integration-apply'

export const gitAt = async (cwd: string, ...args: string[]) =>
  (await gitExecFileAsync(args, { cwd, timeout: 30_000 })).stdout.trim()

export async function integrationFixture(root: string) {
  const f = await verificationGitFixture(root)
  f.db.db.prepare('UPDATE task_stages SET spec = ? WHERE task_id = ?').run(
    JSON.stringify({
      ...f.task.spec,
      requiredEvidence: undefined,
      acceptanceCriteria: [
        { text: 'Offline check', check: { kind: 'command', command: 'node -e ""' } }
      ]
    }),
    f.task.taskId
  )
  const runtime = verificationRuntime()
  runtime.showRepo.mockImplementation(() => f.runtime.showRepo())
  const makeRecord = runtime.createManagedWorktree.getMockImplementation()!
  const removeRecord = runtime.removeManagedWorktree.getMockImplementation()!
  runtime.createManagedWorktree.mockImplementation(async (args) => {
    if (!args.branchNameOverride || !args.baseBranch) {
      throw new Error('Missing scratch branch')
    }
    const directory = path.join(root, args.name)
    const branch = args.branchNameOverride
    const exists = await f.git('for-each-ref', '--format=%(refname)', `refs/heads/${branch}`)
    await addWorktree(
      f.repo,
      directory,
      branch,
      args.baseBranch,
      false,
      false,
      exists ? { checkoutExistingBranch: true } : {}
    )
    const result = await makeRecord(args)
    const row = (await listWorktrees(f.repo)).find((w) => w.path === directory)
    if (!row) {
      throw new Error('Missing created worktree')
    }
    Object.assign(result.worktree, row, { id: `repo::${directory}`, git: row })
    return result
  })
  runtime.listManagedWorktrees.mockImplementation(async () => {
    const rows = await listWorktrees(f.repo)
    return {
      worktrees: runtime.worktrees.flatMap((w) => {
        const row = rows.find((r) => r.path === w.path)
        return row ? [{ ...w, ...row, git: row }] : []
      }),
      totalCount: runtime.worktrees.length,
      truncated: false
    }
  })
  runtime.removeManagedWorktree.mockImplementation(async (selector) => {
    const worktree = runtime.worktrees.find((w) => `id:${w.id}` === selector)
    if (!worktree) {
      throw new Error('selector_not_found')
    }
    const row = (await listWorktrees(f.repo)).find((w) => w.path === worktree.path)
    if (!row) {
      throw new Error('worktree_not_found')
    }
    const result = await removeWorktree(f.repo, worktree.path, true, { knownRemovedWorktree: row })
    await removeRecord(selector)
    return result
  })
  for (const to of ['VERIFYING', 'VERIFIED', 'INTEGRATION_READY'] as const) {
    f.controller.transitionTaskStage({
      taskId: f.task.taskId,
      to,
      actor: 'test',
      reason: 'fixture'
    })
  }
  const effects = new EffectOutbox({ db: f.db, store: f.store, epoch: 'current' })
  registerIntegrationApply({
    store: f.store,
    missions: f.controller,
    runtime,
    effects,
    artifacts: f.artifacts
  })
  const enqueue = () =>
    f.store.transaction('test_integration', () =>
      effects.enqueue({
        kind: 'integration.apply',
        missionId: f.missionId,
        key: f.candidate.id,
        payload: { taskId: f.task.taskId, candidateId: f.candidate.id }
      })
    )
  const run = async () => {
    await effects.recoverAtBoot()
    effects.start()
    await effects.kick()
  }
  return {
    ...f,
    runtime,
    effects,
    enqueue,
    run,
    root,
    integrationRef: `refs/heads/axiom/integration/${f.missionId}`,
    effect: () => f.store.getEffect('integration.apply', f.candidate.id),
    batches: () =>
      f.store.listIntegrationBatches({ missionId: f.missionId, candidateId: f.candidate.id }),
    audits: () => f.store.listAuditEvents({ missionId: f.missionId })
  }
}

export type IntegrationFixture = Awaited<ReturnType<typeof integrationFixture>>

export async function conflictHead(f: IntegrationFixture) {
  const paths = [f.scopePath, 'file with space.txt'].sort()
  await f.git('checkout', '--detach', f.candidate.commitSha)
  await writeFile(
    path.join(
      f.repo,
      paths.find((p) => p !== f.scopePath)!
    ),
    'candidate'
  )
  await f.git('add', '.')
  await f.git('commit', '--no-gpg-sign', '-qm', 'candidate with spaced path')
  f.candidate.commitSha = await f.git('rev-parse', 'HEAD')
  f.candidate.treeSha = await f.git('rev-parse', 'HEAD^{tree}')
  f.db.db
    .prepare('UPDATE candidates SET commit_sha = ?, tree_sha = ? WHERE id = ?')
    .run(f.candidate.commitSha, f.candidate.treeSha, f.candidate.id)
  await f.git('checkout', '--detach', f.baseSha)
  for (const name of paths) {
    await mkdir(path.dirname(path.join(f.repo, name)), { recursive: true })
    await writeFile(path.join(f.repo, name), 'integration')
  }
  await f.git('add', '.')
  await f.git('commit', '--no-gpg-sign', '-qm', 'conflicting integration head')
  const head = await f.git('rev-parse', 'HEAD')
  await f.git('update-ref', f.integrationRef, head)
  await f.git('checkout', '--detach', f.candidate.commitSha)
  return { paths, head }
}
