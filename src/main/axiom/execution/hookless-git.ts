import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'

export function confinedGitEnv(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return { ...env, GIT_CEILING_DIRECTORIES: path.dirname(cwd) }
}

export async function withHooklessGit<T>(
  cwd: string,
  settings: { timeout: number | undefined; confine: boolean; env?: NodeJS.ProcessEnv },
  consume: (git: {
    hooks: readonly string[]
    options: ReturnType<typeof gitOptionsForWorktree> & {
      timeout?: number
      env?: NodeJS.ProcessEnv
    }
    directory: string
  }) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), 'axiom-hookless-git-'))
  try {
    const options = {
      ...gitOptionsForWorktree(cwd),
      ...(settings.timeout !== undefined ? { timeout: settings.timeout } : {}),
      ...(settings.confine
        ? { env: confinedGitEnv(cwd, settings.env) }
        : settings.env !== undefined
          ? { env: settings.env }
          : {})
    }
    return await consume({ hooks: ['-c', `core.hooksPath=${directory}`], options, directory })
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}
