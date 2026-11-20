import type { DeliveryInput } from '../approval/delivery-check'
import { advanceLocalBranch } from '../execution/integration-base'
import { integrationRepository } from '../integration/integration-head'
import { readIntegrationGit } from '../integration/integration-merge'
import { readIntegrationHead, type IntegrationRuntime } from '../integration/integration-scratch'
import { MissionControllerError } from '../mission-controller/controller-context'
import type { MissionController } from '../mission-controller/mission-controller'

// ponytail: process-local exclusion only; persisted delivery recovery belongs to M4-4.
const delivering = new Set<string>()

function unavailable(
  input: DeliveryInput,
  reason: 'in_progress' | 'git_unreadable' | 'write_not_taken'
) {
  return new MissionControllerError('delivery_unavailable', {
    missionId: input.missionId,
    approvalId: input.approvalId,
    reason
  })
}

function absent(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 1
}

export async function deliverMission(
  runtime: IntegrationRuntime,
  missions: MissionController,
  input: DeliveryInput
) {
  if (delivering.has(input.missionId)) {
    throw unavailable(input, 'in_progress')
  }
  delivering.add(input.missionId)
  try {
    const { mission, record } = missions.checkDelivery(input)
    let repoPath: string
    let remotes: string
    let integrationHead: string
    let targetHead: string | undefined
    try {
      repoPath = await integrationRepository(runtime, mission)
      remotes = await readIntegrationGit(repoPath, ['remote'], true)
      integrationHead = await readIntegrationHead(runtime, mission)
      try {
        targetHead = (
          await readIntegrationGit(
            repoPath,
            ['rev-parse', '--verify', '--quiet', `refs/heads/${record.targetBranch}^{commit}`],
            true
          )
        ).trim()
      } catch (error) {
        if (!absent(error)) {
          throw error
        }
      }
    } catch {
      throw unavailable(input, 'git_unreadable')
    }
    if (remotes.trim()) {
      return missions.settleDelivery({ ...input, kind: 'stopped', reason: 'remote_configured' })
    }
    if (integrationHead !== record.integrationHead) {
      return missions.settleDelivery({
        ...input,
        kind: 'stopped',
        reason: 'integration_head_unexpected'
      })
    }
    if (targetHead === undefined || targetHead !== record.targetHead) {
      return missions.settleDelivery({
        ...input,
        kind: 'inputs_changed',
        reason: targetHead === undefined ? 'target_branch_not_found' : 'target_branch_moved'
      })
    }
    if (targetHead === integrationHead) {
      return missions.settleDelivery({ ...input, kind: 'completed', outcome: 'up_to_date' })
    }
    let verifySignatures = false
    try {
      verifySignatures =
        (
          await readIntegrationGit(
            repoPath,
            ['config', '--type=bool', '--get', 'merge.verifySignatures'],
            true
          )
        ).trim() === 'true'
    } catch (error) {
      if (!absent(error)) {
        throw unavailable(input, 'git_unreadable')
      }
    }
    if (verifySignatures) {
      return missions.settleDelivery({
        ...input,
        kind: 'stopped',
        reason: 'signature_verification_required'
      })
    }
    missions.settleDelivery({ ...input, kind: 'started' })
    const moved = await advanceLocalBranch({
      repoPath,
      ref: `refs/heads/${record.targetBranch}`,
      from: targetHead,
      to: integrationHead,
      hooks: 'on',
      reflogMessage: `axiom: deliver ${mission.id}`
    })
    if (moved.advanced && moved.written) {
      return missions.settleDelivery({ ...input, kind: 'completed', outcome: 'fast_forwarded' })
    }
    if (moved.advanced || moved.reason === 'moved') {
      return missions.settleDelivery({
        ...input,
        kind: 'inputs_changed',
        reason: 'target_branch_moved'
      })
    }
    if (moved.reason === 'checked_out') {
      return missions.settleDelivery({
        ...input,
        kind: 'stopped',
        reason: 'target_checked_out',
        worktreePath: moved.worktreePath
      })
    }
    throw unavailable(input, 'write_not_taken')
  } finally {
    delivering.delete(input.missionId)
  }
}
