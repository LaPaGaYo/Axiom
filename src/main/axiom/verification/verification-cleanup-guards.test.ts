import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { gitAt, kernelWorktreeRuntime } from '../integration/integration-fixture.test-support'
import { verificationGitFixture, verificationRuntime } from './verification-fixture.test-support'
import { VerificationService } from './verification-service'
import { prepareVerification } from './verification-prepare'
import { runVerificationChecks } from './verification-checks'
import { removeVerificationWorktree } from './verification-worktree'
import * as runner from '../../git/runner'

let root: string
const fixtures: Awaited<ReturnType<typeof verificationGitFixture>>[] = []
const services: VerificationService[] = []
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'axiom-verification-guards-')))
})
afterEach(async () => {
  for (const service of services.splice(0)) {
    await service.stop()
  }
  vi.restoreAllMocks()
  for (const f of fixtures.splice(0)) {
    f.db.close()
  }
  await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const directory = path.join(root, `case-${fixtures.length}`)
  await mkdir(directory)
  const f = await verificationGitFixture(directory)
  fixtures.push(f)
  return { ...f, root: directory }
}

it('removes the worktree even when its branch cannot be put back', async () => {
  for (const occupied of [false, true]) {
    const f = await fixture()
    const runtime = kernelWorktreeRuntime(f, f.root)
    const deps = {
      store: f.store,
      missions: f.controller,
      artifacts: f.artifacts,
      runtime,
      runtimeEpoch: 'current'
    }
    f.db.db.prepare('UPDATE task_stages SET spec = ? WHERE task_id = ?').run(
      JSON.stringify({
        ...f.task.spec,
        requiredEvidence: undefined,
        acceptanceCriteria: [
          { text: 'Check passes', check: { kind: 'command', command: 'node -e ""' } }
        ]
      }),
      f.task.taskId
    )
    const service = new VerificationService(deps)
    services.push(service)
    const prepared = (await prepareVerification(deps, service.claimNext()!))!
    const directory = runtime.worktrees[0].path
    const branch = `axiom/verify/${prepared.id}/${prepared.claimCount}`
    const other = path.join(f.root, 'occupied')
    await (occupied ? f.git('worktree', 'add', other, branch) : f.git('branch', '-D', branch))
    const headPath = path.resolve(
      directory,
      await gitAt(directory, 'rev-parse', '--git-path', 'HEAD')
    )
    const before = await readFile(headPath, 'utf8')
    const remove = runtime.removeManagedWorktree.getMockImplementation()!
    const atRemoval: string[] = []
    runtime.removeManagedWorktree.mockImplementation(async (selector) => {
      atRemoval.push(await readFile(headPath, 'utf8'))
      return remove(selector)
    })
    await expect(runVerificationChecks(deps, prepared)).resolves.toBeUndefined()
    expect(atRemoval).toEqual([before])
    expect(await f.git('worktree', 'list', '--porcelain')).not.toContain(directory)
    expect(f.store.getVerificationRun(f.run.id)).toMatchObject({
      status: 'PASS',
      worktreeId: null,
      verdictDetail: { cleanupPending: false }
    })
    if (occupied) {
      expect(await f.git('worktree', 'list', '--porcelain')).toContain(other)
      expect(await gitAt(other, 'symbolic-ref', '-q', 'HEAD')).toBe(`refs/heads/${branch}`)
      expect(await gitAt(other, 'rev-parse', 'HEAD')).toBe(f.candidate.commitSha)
      expect(await gitAt(other, 'status', '--porcelain')).toBe('')
      expect(await f.git('rev-parse', `refs/heads/${branch}`)).toBe(f.candidate.commitSha)
    } else {
      expect(await f.git('for-each-ref', `refs/heads/${branch}`)).toBe('')
    }
  }
})

it('does not touch the repository above a verification directory that has none of its own', async () => {
  const f = await fixture()
  const runtime = verificationRuntime()
  const directory = path.join(f.repo, 'verification-without-git')
  await mkdir(directory)
  const branch = 'axiom/verify/unrecorded/1'
  await f.git('branch', branch)
  const before = await f.git('symbolic-ref', '-q', 'HEAD')
  const runGit = runner.gitExecFileAsync
  const git = vi.spyOn(runner, 'gitExecFileAsync')
  await expect(
    removeVerificationWorktree(runtime, `repo::${directory}`, branch)
  ).resolves.toBeUndefined()
  expect(git.mock.calls.filter(([, options]) => options?.cwd === directory)).toEqual([])
  expect(await f.git('symbolic-ref', '-q', 'HEAD')).toBe(before)

  // The entry can disappear after lstat; real Git must still refuse the parent repository.
  await writeFile(path.join(directory, '.git'), 'gitdir: missing\n')
  let removed = false
  git.mockImplementation(async (args, options) => {
    if (options?.cwd === directory && !removed) {
      await rm(path.join(directory, '.git'))
      removed = true
    }
    return runGit(args, options)
  })
  await expect(
    removeVerificationWorktree(runtime, `repo::${directory}`, branch)
  ).resolves.toBeUndefined()
  expect(await f.git('symbolic-ref', '-q', 'HEAD')).toBe(before)
  for (const [, options] of git.mock.calls.filter(([, options]) => options?.cwd === directory)) {
    expect(options?.env).toMatchObject({
      ...process.env,
      GIT_CEILING_DIRECTORIES: path.dirname(directory)
    })
  }
  expect(await f.git('rev-parse', `refs/heads/${branch}`)).toBe(f.candidate.commitSha)
  expect(runtime.removeManagedWorktree).toHaveBeenCalledTimes(2)
})
