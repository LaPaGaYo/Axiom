import path from 'node:path'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import type { Mission } from '../../../shared/axiom-contract/mission-objects'
import type { IntegrationBatch } from '../../../shared/axiom-contract/integration-batch'
import type { AxiomStore } from '../db/axiom-store'
import { readIntegrationGit, writeIntegrationGit } from './integration-merge'
import { auditIntegration } from './integration-settlement'
import { integrationRepository } from './integration-head'

export type IntegrationRuntime = Pick<
  OrcaRuntimeService,
  'createManagedWorktree' | 'removeManagedWorktree' | 'listManagedWorktrees' | 'showRepo'
>
export type IntegrationScratch = { id: string; cwd: string; branch: string | null }
export const integrationHeadRef = (missionId: string) => `refs/heads/axiom/integration/${missionId}`

export async function readIntegrationHead(
  runtime: IntegrationRuntime,
  mission: Mission
): Promise<string> {
  const repoPath = await integrationRepository(runtime, mission)
  try {
    return (
      await readIntegrationGit(
        repoPath,
        ['rev-parse', '--verify', `${integrationHeadRef(mission.id)}^{commit}`],
        true
      )
    ).trim()
  } catch {
    throw new Error('integration_head_unavailable')
  }
}

async function removeScratch(runtime: IntegrationRuntime, id: string) {
  try {
    return await runtime.removeManagedWorktree(`id:${id}`, {
      force: true,
      waitForBackgroundRemoval: true
    })
  } catch (error) {
    if (
      error instanceof Error &&
      (['selector_not_found', 'worktree_not_found'].includes(error.message) ||
        ('code' in error && error.code === 'ENOENT'))
    ) {
      return {}
    }
    throw new Error('scratch_worktree_unavailable')
  }
}

export async function removeIntegrationLeftovers(
  runtime: IntegrationRuntime,
  batch: IntegrationBatch
): Promise<void> {
  try {
    const listed = await runtime.listManagedWorktrees(undefined, Number.MAX_SAFE_INTEGER)
    const name = `integrate-${batch.id}`
    for (const worktree of listed.worktrees) {
      const directory = path.basename(worktree.path)
      if (
        directory === name ||
        (directory.startsWith(`${name}-`) && /^\d+$/.test(directory.slice(name.length + 1)))
      ) {
        await removeScratch(runtime, worktree.id)
      }
    }
  } catch {
    throw new Error('scratch_worktree_unavailable')
  }
}

export async function createIntegrationScratch(
  runtime: IntegrationRuntime,
  mission: Mission,
  batch: IntegrationBatch,
  taskId: string
): Promise<IntegrationScratch> {
  try {
    const created = await runtime.createManagedWorktree({
      repoSelector: `id:${mission.repoId}`,
      name: `integrate-${batch.id}`,
      branchNameOverride: `axiom/integrating/${batch.id}`,
      baseBranch: integrationHeadRef(mission.id),
      runHooks: false,
      setupDecision: 'skip',
      awaitTerminalProvisioning: false,
      observeSetupCompletion: false,
      activate: false,
      lineage: {
        noParent: true,
        orchestrationContext: { orchestrationRunId: mission.runId, taskId }
      }
    })
    const split = splitWorktreeIdForFilesystem(created.worktree.id)
    if (!split?.worktreePath) {
      await removeScratch(runtime, created.worktree.id)
      throw new Error('scratch_worktree_unavailable')
    }
    return { id: created.worktree.id, cwd: split.worktreePath, branch: null }
  } catch {
    throw new Error('scratch_worktree_unavailable')
  }
}

export async function detachIntegrationScratch(
  scratch: IntegrationScratch,
  baseCommit: string,
  mergeCommit?: string
): Promise<void> {
  let head: string
  try {
    head = (await readIntegrationGit(scratch.cwd, ['rev-parse', 'HEAD'])).trim()
    scratch.branch = (
      await readIntegrationGit(scratch.cwd, ['symbolic-ref', '--short', 'HEAD'])
    ).trim()
  } catch {
    throw new Error('scratch_worktree_unavailable')
  }
  if (head !== baseCommit) {
    throw new Error('integration_head_moved')
  }
  try {
    await writeIntegrationGit(scratch.cwd, ['checkout', '--detach', mergeCommit ?? baseCommit])
  } catch {
    throw new Error(mergeCommit ? 'merged_commit_unavailable' : 'scratch_worktree_unavailable')
  }
}

export async function returnIntegrationScratch(
  runtime: IntegrationRuntime,
  store: AxiomStore,
  batch: IntegrationBatch,
  scratch: IntegrationScratch
): Promise<void> {
  let branchPreserved = false
  if (scratch.branch) {
    try {
      await writeIntegrationGit(scratch.cwd, ['checkout', scratch.branch])
    } catch {
      branchPreserved = true
    }
  }
  let removalFailed = false
  try {
    const removed = await removeScratch(runtime, scratch.id)
    branchPreserved ||= Boolean(removed.preservedBranch)
  } catch {
    removalFailed = true
  }
  if (branchPreserved) {
    auditIntegration(store, batch, 'integration.cleanup_failed', { reason: 'branch_preserved' })
  }
  if (removalFailed) {
    auditIntegration(store, batch, 'integration.cleanup_failed', { reason: 'worktree_removal' })
  }
}
