import { mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { getAppEnvironment } from '../../../shared/app-environment'
import { MAX_ARTIFACT_BYTES } from '../../../shared/axiom-contract/artifact-params'
import type { HeadlessSubmissionReportSchema } from '../../../shared/axiom-contract/submission-params'
import { GitObjectIdSchema } from '../../../shared/axiom-contract/submission-params'
import { gitExecFileAsync } from '../../git/runner'
import type { ArtifactStore } from '../artifacts/artifact-store'

export const HeadlessLaunchSchema = z.object({
  baselineSha: GitObjectIdSchema,
  worktreeId: z.string().min(1),
  branch: z.string().min(1)
})

export function headlessAttemptDirectory(attemptId: string): string {
  const id = z
    .string()
    .regex(/^[\w-]+$/)
    .parse(attemptId)
  return path.join(getAppEnvironment().getPath('userData'), 'axiom', 'attempts', id)
}

export async function prepareHeadlessAttemptFiles(input: {
  attemptId: string
  worktree: string
  worktreeId: string
  branch: string
  prompt: string
}) {
  const directory = headlessAttemptDirectory(input.attemptId)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const local = path.join(input.worktree, '.axiom')
  await mkdir(local, { recursive: true })
  if ((await realpath(local)) !== path.join(await realpath(input.worktree), '.axiom')) {
    throw new Error('Unsafe .axiom directory')
  }
  // Never follow a repository-provided prompt symlink while writing the recovery copy.
  const copy = await open(
    path.join(local, 'prompt.md'),
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o600
  )
  try {
    await copy.writeFile(input.prompt)
  } finally {
    await copy.close()
  }
  await writeFile(path.join(directory, 'prompt.md'), input.prompt, { mode: 0o600, flag: 'wx' })
  const baselineSha = (
    await gitExecFileAsync(['rev-parse', 'HEAD'], { cwd: input.worktree })
  ).stdout.trim()
  const launch = HeadlessLaunchSchema.parse({
    baselineSha,
    worktreeId: input.worktreeId,
    branch: input.branch
  })
  await writeFile(path.join(directory, 'launch.json'), JSON.stringify(launch), {
    mode: 0o600,
    flag: 'wx'
  })
  return directory
}

export async function readHeadlessFile(
  directory: string,
  name: string
): Promise<string | undefined> {
  try {
    return await readFile(path.join(directory, name), 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

export async function ingestHeadlessArtifacts(input: {
  artifacts: ArtifactStore
  worktree: string
  missionId: string
  taskId: string
  attemptId: string
  entries: z.infer<typeof HeadlessSubmissionReportSchema>['artifacts']
}) {
  const ids: string[] = []
  const worktree = await realpath(input.worktree)
  const root = path.join(worktree, '.axiom', 'artifacts')
  for (const entry of input.entries) {
    const resolved = await realpath(path.resolve(worktree, entry.path))
    if (!entry.path.startsWith('.axiom/artifacts/') || !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error('Invalid report artifact path: expected .axiom/artifacts/')
    }
    const file = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW)
    let content: Buffer
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_ARTIFACT_BYTES) {
        throw new Error('Invalid report artifact file')
      }
      content = await file.readFile()
    } finally {
      await file.close()
    }
    const artifact = await input.artifacts.put({
      missionId: input.missionId,
      kind: entry.kind,
      mediaType: entry.mediaType,
      content,
      createdBy: `attempt:${input.attemptId}`,
      related: [input.taskId, input.attemptId]
    })
    ids.push(artifact.id)
  }
  return ids
}
