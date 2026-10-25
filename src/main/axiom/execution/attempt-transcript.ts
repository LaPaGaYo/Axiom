import type { z } from 'zod'
import { MAX_ARTIFACT_BYTES } from '../../../shared/axiom-contract/artifact-params'
import type { SubmissionSchema } from '../../../shared/axiom-contract/submission-params'
import {
  getCommandTokenPathBasename,
  getFirstCommandToken
} from '../../../shared/command-token-scanner'
import {
  collectDescendantsFromIndex,
  getProcessTableIndex
} from '../../../shared/process-table-index'
import type { ProcessTableRow } from '../../../shared/process-table-snapshot'
import { getFreshProcessTableSnapshot } from '../../../shared/process-table-snapshot-reader'
import { readWorkerTerminalHostScope } from '../../../shared/worker-terminal-host-scope'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { captureWorkerOutputArchive } from '../../runtime/orchestration/worker-output-archive'
import { orchestrationTimestampToMs } from '../../runtime/rpc/methods/orchestration/worker/worker-output'
import { resolveStructuredWorkerForDispatch } from '../../runtime/rpc/methods/orchestration-structured-worker-lifecycle'
import { redactContext } from '../context-builder/redaction'
import { getAxiomControlPlane } from '../control-plane'

export type SubmittedAttempt = Pick<
  z.infer<typeof SubmissionSchema>,
  'missionId' | 'taskId' | 'attemptId' | 'id'
>

export function summarizeSubmissionProcesses(rows: readonly ProcessTableRow[], shellPid: number) {
  const descendants = collectDescendantsFromIndex(getProcessTableIndex(rows), shellPid).filter(
    (row) => !row.stat.includes('Z')
  )
  const names = descendants.map(
    (row) => redactContext(getCommandTokenPathBasename(getFirstCommandToken(row.command))).content
  )
  return {
    count: descendants.length,
    names: [...new Set(names.filter(Boolean))].sort().slice(0, 50)
  }
}

export async function captureSubmissionProcesses(
  runtime: OrcaRuntimeService,
  terminalHandle: string
) {
  try {
    const { foregroundProcessEvidence: evidence } =
      await runtime.inspectTerminalProcess(terminalHandle)
    if (evidence?.verdict !== 'live') {
      return { unverifiable: 'process_evidence_unavailable' } as const
    }
    if (evidence.fence.platform !== 'posix' || process.platform === 'win32') {
      return { unverifiable: 'platform_unsupported' } as const
    }
    return summarizeSubmissionProcesses(
      await getFreshProcessTableSnapshot(),
      evidence.fence.shellPid
    )
  } catch {
    return { unverifiable: 'process_inspection_failed' } as const
  }
}

// Redact values before serialization so quotes, escapes and nested JSON structure remain intact.
export function redactTranscriptContent(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactContext(value).content
  }
  if (Array.isArray(value)) {
    return value.map(redactTranscriptContent)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactTranscriptContent(entry)])
    )
  }
  return value
}

export async function archiveAttemptTranscript(
  runtime: OrcaRuntimeService,
  submission: SubmittedAttempt
) {
  const { store, artifacts } = getAxiomControlPlane(runtime)
  const { missionId, taskId, attemptId, id: submissionId } = submission
  let reason = 'capture_failed'
  try {
    const db = runtime.getOrchestrationDb()
    const worker = db.getWorkerDispatch(attemptId)
    if (!worker?.agent_terminal_handle) {
      throw new Error('worker_unavailable')
    }
    const capturedAt = new Date().toISOString()
    const capture = await captureWorkerOutputArchive({
      runtime,
      dispatchId: attemptId,
      terminalHandle: worker.agent_terminal_handle,
      attachedAtMs: orchestrationTimestampToMs(worker.created_at),
      structuredWorker: resolveStructuredWorkerForDispatch(db, attemptId)
    })
    // Never interpret a remote PID using the local process table, including WSL guests.
    const host = readWorkerTerminalHostScope(
      db.getWorkerTerminalResourceByOwner(attemptId)?.host_scope
    )
    const processesAtSubmission =
      host.kind === 'absent' || (host.kind === 'local' && host.scope?.kind !== 'wsl')
        ? await captureSubmissionProcesses(runtime, worker.agent_terminal_handle)
        : { unverifiable: 'host_unsupported' }
    const document = {
      type: 'attempt_transcript',
      version: 1,
      missionId,
      taskId,
      attemptId,
      submissionId,
      capturedAt,
      source: capture.kind,
      status: capture.status,
      processesAtSubmission,
      content: redactTranscriptContent(capture.content)
    }
    let content = Buffer.from(JSON.stringify(document))
    if (content.length > MAX_ARTIFACT_BYTES) {
      content = Buffer.from(JSON.stringify({ ...document, content: { omitted: 'too_large' } }))
    }
    reason = 'store_failed'
    const artifact = await artifacts.put({
      missionId,
      kind: 'log',
      mediaType: 'application/json',
      createdBy: 'AttemptSettlement',
      related: [taskId, attemptId, submissionId],
      content
    })
    store.appendAuditEvent({
      missionId,
      actor: 'AttemptSettlement',
      objectKind: 'attempt',
      objectId: attemptId,
      event: 'attempt.transcript_archived',
      before: null,
      after: {
        submissionId,
        artifactId: artifact.id,
        source: capture.kind,
        status: capture.status,
        ...('count' in processesAtSubmission ? { processCount: processesAtSubmission.count } : {})
      }
    })
  } catch {
    try {
      store.appendAuditEvent({
        missionId,
        actor: 'AttemptSettlement',
        objectKind: 'attempt',
        objectId: attemptId,
        event: 'attempt.transcript_archive_failed',
        before: null,
        after: { submissionId, reason }
      })
    } catch {
      // A failed audit write must not suppress the already-settled Submission's receipt.
      console.warn('[axiom] Transcript archive audit failed', { attemptId, submissionId })
    }
  }
}
