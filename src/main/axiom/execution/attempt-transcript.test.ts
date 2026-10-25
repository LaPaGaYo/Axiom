import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WorkerOutputArchiveCapture } from '../../runtime/orchestration/worker-output-archive'
import * as structured from '../../runtime/rpc/methods/orchestration-structured-worker-lifecycle'
import * as processTable from '../../../shared/process-table-snapshot-reader'
import { MAX_ARTIFACT_BYTES } from '../../../shared/axiom-contract/artifact-params'
import { orchestrationTimestampToMs } from '../../runtime/rpc/methods/orchestration/worker/worker-output'
import {
  captureSubmissionProcesses,
  redactTranscriptContent,
  summarizeSubmissionProcesses
} from './attempt-transcript'
import { submissionFixture } from './submission-fixture.test-support'

let f: ReturnType<typeof submissionFixture>
beforeEach(() => {
  f = submissionFixture()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  f.db.close()
})
const token = `${'gh' + 'p_'}${'T'.repeat(36)}`
const messages = [
  {
    id: 'message',
    role: 'assistant' as const,
    timestamp: null,
    source: 'transcript' as const,
    blocks: [{ type: 'text' as const, text: `"quote"\n${token}\\path` }]
  }
]
const captures: WorkerOutputArchiveCapture[] = [
  {
    kind: 'terminal_tail',
    status: 'captured',
    content: {
      lines: [token],
      draft: token,
      truncated: false,
      terminalStatus: 'running',
      warnings: [token]
    }
  },
  {
    kind: 'transcript_pin',
    status: 'captured',
    content: {
      version: 2,
      agent: 'codex',
      processIncarnation: 'process',
      messages,
      limited: false,
      warnings: [token]
    }
  },
  {
    kind: 'structured_journal',
    status: 'captured',
    content: {
      version: 1,
      agent: 'codex',
      processIncarnation: 'process',
      messages,
      limited: false,
      warnings: [token]
    }
  },
  {
    kind: 'structured_journal',
    status: 'empty',
    content: {
      version: 1,
      agent: 'codex',
      processIncarnation: 'process',
      messages: [],
      limited: false,
      warnings: []
    }
  },
  {
    kind: 'terminal_tail',
    status: 'empty',
    content: { lines: [], truncated: false, terminalStatus: 'exited', warnings: [] }
  }
]
it.each(captures)(
  'archives $kind / $status with attribution and deep redaction',
  async (capture) => {
    f.capture.mockResolvedValueOnce(capture)
    expect(await f.submit()).toMatchObject({ ok: true })
    const submission = f.store.getSubmissionByDispatch(f.t01.attemptId)!
    const stored = f.put.mock.calls[0]![0]
    expect(stored).toMatchObject({
      missionId: f.mission.id,
      kind: 'log',
      mediaType: 'application/json',
      createdBy: 'AttemptSettlement',
      related: [f.t01.taskId, f.t01.attemptId, submission.id]
    })
    expect(stored.content.toString().includes(token)).toBe(false)
    if (capture.status === 'captured') {
      expect(stored.content.toString()).toContain('[REDACTED]')
    }
    expect(JSON.parse(stored.content.toString())).toMatchObject({
      type: 'attempt_transcript',
      version: 1,
      missionId: f.mission.id,
      taskId: f.t01.taskId,
      attemptId: f.t01.attemptId,
      submissionId: submission.id,
      capturedAt: expect.any(String),
      source: capture.kind,
      status: capture.status,
      processesAtSubmission: { unverifiable: 'process_evidence_unavailable' },
      content: redactTranscriptContent(capture.content)
    })
    expect(f.capture).toHaveBeenCalledExactlyOnceWith({
      runtime: f.runtime,
      dispatchId: f.t01.attemptId,
      terminalHandle: f.t01.from,
      structuredWorker: null,
      attachedAtMs: orchestrationTimestampToMs(f.db.getWorkerDispatch(f.t01.attemptId)!.created_at)
    })
    expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
      expect.objectContaining({
        event: 'attempt.transcript_archived',
        objectKind: 'attempt',
        objectId: f.t01.attemptId,
        after: {
          submissionId: submission.id,
          artifactId: expect.any(String),
          source: capture.kind,
          status: capture.status
        }
      })
    )
  }
)
it('redacts nested string values without changing keys, scalar values, or JSON escaping', () => {
  const nested = {
    [token]: [{ nil: null, number: 3, flag: true, value: `"${token}"\n\\` }],
    empty: []
  }
  const result = redactTranscriptContent(nested)
  expect(JSON.parse(JSON.stringify(result))).toEqual({
    [token]: [{ nil: null, number: 3, flag: true, value: '"[REDACTED]"\n\\' }],
    empty: []
  })
  expect(nested[token][0].value).toContain(token)
})
it('passes the resolved structured identity into the pure capture reader', async () => {
  const identity = {
    handle: 'structured',
    sessionId: 'session',
    agent: 'codex' as const,
    paneKey: 'pane',
    processIncarnation: 'incarnation',
    worktreeId: 'worktree',
    hostScope: { kind: 'local' as const, hostId: 'local' as const }
  }
  vi.spyOn(structured, 'resolveStructuredWorkerForDispatch').mockReturnValue(identity)
  expect(await f.submit()).toMatchObject({ ok: true })
  expect(f.capture).toHaveBeenCalledWith(expect.objectContaining({ structuredWorker: identity }))
})
it('uses distinct artifact content for identical captures belonging to different Attempts', async () => {
  expect(await f.submit()).toMatchObject({ ok: true })
  expect(await f.submit(f.bind('T02'))).toMatchObject({ ok: true })
  const artifacts = f.store.listArtifacts({ missionId: f.mission.id, kind: 'log' })
  expect(artifacts).toHaveLength(2)
  expect(artifacts[0].sha256).not.toBe(artifacts[1].sha256)
  expect(artifacts[0].related).not.toEqual(artifacts[1].related)
})
it('replaces only oversized content while preserving the document metadata', async () => {
  f.capture.mockResolvedValueOnce({
    kind: 'terminal_tail',
    status: 'captured',
    content: {
      lines: ['x'.repeat(MAX_ARTIFACT_BYTES)],
      truncated: false,
      terminalStatus: 'running',
      warnings: []
    }
  })
  expect(await f.submit()).toMatchObject({ ok: true })
  const stored = f.put.mock.calls[0]![0].content
  expect(stored.length).toBeLessThanOrEqual(MAX_ARTIFACT_BYTES)
  expect(JSON.parse(stored.toString())).toMatchObject({
    type: 'attempt_transcript',
    attemptId: f.t01.attemptId,
    source: 'terminal_tail',
    status: 'captured',
    content: { omitted: 'too_large' }
  })
})
it.each(['capture', 'put'] as const)(
  'audits a fixed reason on %s failure and still returns a settled receipt',
  async (operation) => {
    f[operation].mockRejectedValueOnce(new Error(token))
    expect(await f.submit()).toMatchObject({ ok: true, result: { duplicate: false } })
    const events = f.store.listAuditEvents({ missionId: f.mission.id })
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'attempt.transcript_archive_failed',
        after: {
          submissionId: f.store.getSubmissionByDispatch(f.t01.attemptId)!.id,
          reason: operation === 'capture' ? 'capture_failed' : 'store_failed'
        }
      })
    )
    expect(JSON.stringify(events)).not.toContain(token)
    expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('SUBMITTED')
    expect(f.store.listVerificationRuns({ missionId: f.mission.id })[0]?.status).toBe('QUEUED')
    expect(await f.submit()).toMatchObject({ ok: true, result: { duplicate: true } })
    expect(f.capture).toHaveBeenCalledTimes(1)
  }
)

const rows = [
  { pid: 1, ppid: 0, stat: 'S', command: '/bin/zsh' },
  { pid: 2, ppid: 1, stat: 'S', command: `/usr/bin/node --token=${token}` },
  { pid: 3, ppid: 2, stat: 'S', command: '"/opt/Some Dir/server" --watch' },
  { pid: 4, ppid: 1, stat: 'SZ', command: '/bin/zombie' },
  { pid: 5, ppid: 4, stat: 'S', command: '/bin/node different-args' },
  { pid: 6, ppid: 0, stat: 'S', command: '/bin/unrelated' }
]
it('counts only non-zombie descendants and keeps sorted unique executable basenames without arguments', () => {
  expect(summarizeSubmissionProcesses(rows, 1)).toEqual({ count: 3, names: ['node', 'server'] })
  expect(summarizeSubmissionProcesses(rows, 6)).toEqual({ count: 0, names: [] })
})
it('caps sorted names at fifty without capping the live descendant count', () => {
  const many = Array.from({ length: 70 }, (_, i) => ({
    pid: 100 + i,
    ppid: 1,
    stat: 'S',
    command: `/bin/tool${String(i).padStart(2, '0')} --secret`
  }))
  expect(summarizeSubmissionProcesses(many, 1)).toEqual({
    count: 70,
    names: many.slice(0, 50).map((row) => row.command.split(' ')[0].slice(5))
  })
})
const evidence = {
  verdict: 'live' as const,
  processName: 'node',
  authorityGeneration: 'gen',
  observationEpoch: 1,
  capturedAgeMs: 0,
  ptyId: 'pty',
  ptyIncarnationId: 'inc',
  fence: {
    platform: 'posix' as const,
    shellPid: 1,
    shellStartTime: 'start',
    tty: 'tty',
    foregroundPgid: 2
  }
}
it('captures fresh local POSIX descendants and audits their count', async () => {
  vi.stubGlobal('process', { ...process, platform: 'linux' })
  try {
    vi.mocked(f.runtime.inspectTerminalProcess).mockResolvedValue({
      foregroundProcess: 'node',
      hasChildProcesses: true,
      foregroundProcessEvidence: evidence
    })
    const read = vi.spyOn(processTable, 'getFreshProcessTableSnapshot').mockResolvedValue(rows)
    expect(await f.submit()).toMatchObject({ ok: true })
    expect(read).toHaveBeenCalledOnce()
    expect(JSON.parse(f.put.mock.calls[0]![0].content.toString()).processesAtSubmission).toEqual({
      count: 3,
      names: ['node', 'server']
    })
    expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
      expect.objectContaining({
        event: 'attempt.transcript_archived',
        after: expect.objectContaining({ processCount: 3 })
      })
    )
  } finally {
    vi.unstubAllGlobals()
  }
})
it.each(['missing', 'unverifiable', 'windows', 'throw', 'snapshot-throw'])(
  'records only a fixed unverifiable reason for %s process inspection',
  async (mode) => {
    const read = vi
      .spyOn(processTable, 'getFreshProcessTableSnapshot')
      .mockRejectedValue(new Error(token))
    if (mode === 'throw') {
      vi.mocked(f.runtime.inspectTerminalProcess).mockRejectedValue(new Error(token))
    } else if (mode !== 'missing') {
      vi.mocked(f.runtime.inspectTerminalProcess).mockResolvedValue({
        foregroundProcess: null,
        hasChildProcesses: false,
        foregroundProcessEvidence:
          mode === 'unverifiable'
            ? { ...evidence, verdict: 'unverifiable', reason: token }
            : mode === 'windows'
              ? {
                  ...evidence,
                  fence: {
                    platform: 'windows',
                    rootProcessId: 1,
                    rootCreationTime: 'start',
                    sessionId: 'session'
                  }
                }
              : evidence
      })
    }
    expect(await captureSubmissionProcesses(f.runtime, f.t01.from)).toEqual({
      unverifiable: expect.any(String)
    })
    expect(JSON.stringify(await captureSubmissionProcesses(f.runtime, f.t01.from))).not.toContain(
      token
    )
    if (mode !== 'snapshot-throw') {
      expect(read).not.toHaveBeenCalled()
    }
  }
)
it.each([
  '{"kind":"ssh","targetId":"host"}',
  '{"kind":"wsl","hostId":"local","distro":"Ubuntu"}',
  'invalid'
])('does not use the local process table for host scope %s', async (host) => {
  f.db.db
    .prepare('UPDATE worker_terminal_resources SET host_scope = ? WHERE owner_dispatch_id = ?')
    .run(host, f.t01.attemptId)
  expect(await f.submit()).toMatchObject({ ok: true })
  expect(f.runtime.inspectTerminalProcess).not.toHaveBeenCalled()
  expect(JSON.parse(f.put.mock.calls[0]![0].content.toString()).processesAtSubmission).toEqual({
    unverifiable: 'host_unsupported'
  })
})
