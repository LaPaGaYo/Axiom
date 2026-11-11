import { z } from 'zod'
import type { WorkerDispatchRow } from '../../runtime/orchestration/types'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import type { AxiomStore } from '../db/axiom-store'
import { HeadlessLaunchSchema, readHeadlessFile } from './headless-attempt-files'

const unusableLaunchErrors = new WeakSet<Error>()

export function isUnusableHeadlessLaunch(error: unknown): boolean {
  return error instanceof Error && unusableLaunchErrors.has(error)
}

export async function readHeadlessLaunchRecord(directory: string) {
  try {
    return HeadlessLaunchSchema.parse(
      JSON.parse((await readHeadlessFile(directory, 'launch.json')) ?? '{}')
    )
  } catch (error) {
    // Preserve the exit path's original exception while identifying an unusable launch.
    if (error instanceof Error) {
      unusableLaunchErrors.add(error)
    }
    throw error
  }
}

export function resolveHeadlessLaunchRecord(
  launch: z.infer<typeof HeadlessLaunchSchema>,
  worker: WorkerDispatchRow | undefined,
  binding: { branch: string }
) {
  const worktree = splitWorktreeIdForFilesystem(launch.worktreeId)?.worktreePath
  if (!worktree || launch.worktreeId !== worker?.worktree_id || launch.branch !== binding.branch) {
    const error = new Error('Headless launch binding mismatch')
    unusableLaunchErrors.add(error)
    throw error
  }
  return { worktreePath: worktree, branch: launch.branch, baselineSha: launch.baselineSha }
}

export function headlessLaunchProvider(
  store: AxiomStore,
  binding: { agentSpecId: string },
  worker: WorkerDispatchRow | undefined
) {
  // Scratch files are Worker-writable. Provider authority comes from the bound spec or
  // the kernel's durable start options (legacy Codex rows may omit agent).
  return (
    store.getAgentSpec(binding.agentSpecId)?.spec.provider ??
    z
      .object({ agent: z.enum(['codex', 'claude']).default('codex') })
      .parse(JSON.parse(worker?.start_options ?? '{}')).agent
  )
}
