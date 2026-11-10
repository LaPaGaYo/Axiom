import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gitExecFileAsync } from '../../git/runner'

export async function preservedRepository() {
  const root = await mkdtemp(path.join(tmpdir(), 'axiom-preserved-'))
  const git = async (args: string[], cwd = root) =>
    (await gitExecFileAsync(args, { cwd })).stdout.trim()
  const commit = async (message: string) => {
    await git(['add', '.'])
    return git([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--no-gpg-sign',
      '-m',
      message
    ])
  }
  await git(['init'])
  await writeFile(path.join(root, 'code.txt'), 'baseline\n')
  await commit('base')
  const baselineSha = await git(['rev-parse', 'HEAD'])
  await git(['branch', 'axiom/integration/m'])
  const branch = 'axiom/attempt/t/1'
  await git(['checkout', '-b', branch])
  const input = {
    attemptId: 'd1',
    taskId: 't',
    seq: 1,
    missionId: 'm',
    launch: { worktreePath: root, branch, baselineSha },
    allowedPaths: ['**'],
    verificationRules: {}
  }
  return { root, git, commit, baselineSha, branch, input }
}
