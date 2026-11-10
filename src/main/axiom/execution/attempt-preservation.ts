import type { ArtifactStore } from '../artifacts/artifact-store'
import { preserveAttemptWorktree, type PreservationInput } from './preserved-snapshot'
import { HandoffRecordsSchema, readHeadlessHandoffRecords } from './headless-handoff-records'

/** Async capture precedes settlement. Only the caller with current authority writes the audit. */
export async function collectAttemptPreservation(
  artifacts: ArtifactStore,
  input: PreservationInput & { provider: string; eventsText: string }
) {
  const preserved = await preserveAttemptWorktree(input)
  const records = readHeadlessHandoffRecords(input.eventsText, input.provider)
  let artifactId: string | undefined
  if (preserved.status === 'preserved' || records.messages.length || records.commands.length) {
    try {
      const content = HandoffRecordsSchema.parse({
        version: 1,
        taskId: input.taskId,
        attemptId: input.attemptId,
        ...records,
        changes: preserved.status === 'preserved' ? preserved.changes : []
      })
      artifactId = (
        await artifacts.put({
          missionId: input.missionId,
          kind: 'log',
          mediaType: 'application/json',
          createdBy: 'AttemptSettlement',
          related: [input.taskId, input.attemptId],
          content: Buffer.from(JSON.stringify(content))
        })
      ).id
    } catch {
      // Storage failure cannot delay or undo the original exit settlement.
    }
  }
  const result =
    preserved.status === 'preserved'
      ? {
          status: preserved.status,
          snapshot: preserved.snapshot,
          scopePaths: preserved.scopePaths,
          secrets: preserved.secrets
        }
      : preserved
  return {
    taskId: input.taskId,
    result,
    baselineSha: input.launch.baselineSha,
    ...(artifactId ? { artifactId } : {})
  }
}
