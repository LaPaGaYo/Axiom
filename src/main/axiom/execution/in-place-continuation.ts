import { z } from 'zod'
import type { AgentSpec } from '../../../shared/axiom-contract/agent-spec'
import type { AttemptBaseline } from './attempt-baseline'
import { AttemptPreservedAuditSchema } from './preserved-snapshot-contract'
import { certifiedCombo } from '../agent-factory/certified-providers'
import { readEnding, type SnapshotAttemptBaseline } from './preserved-baseline'
import { CodexThreadId, type ResumedSession } from './in-place-session'

export type FreshSessionReason =
  | 'not_interrupted'
  | 'resume_refused'
  | 'no_exit_evidence'
  | 'snapshot_unusable'
  | 'agent_changed'
  | 'capability_unproven'
  | 'account_changed'
  | 'contract_changed'
  | 'session_unknown'
  | 'session_record_missing'
  | 'worktree_changed'
  | 'evidence_unreadable'
export type FreshSession = { strategy: 'fresh'; reason: FreshSessionReason }
export type ContinuationWorktree = {
  worktree: { id: string; path: string }
  targetCommit: string
  parentCommit: string
  treeSha: string
}
export type InPlaceContinuation = ResumedSession &
  ContinuationWorktree & {
    preserved: boolean
    ending: SnapshotAttemptBaseline['ending']
  }
export type ContinuationDecision = FreshSession | InPlaceContinuation
export type ContinuationPredecessor = {
  seq: number
  dispatchId: string
  branch: string
  failure: unknown
  preservation: unknown
  stopped: boolean
  submitted: boolean
  session?: ResumedSession
}
type AgentIdentity = Pick<AgentSpec, 'provider' | 'model' | 'reasoning'>
type Contract = { planRevisionId: string; mandatory: { section: string; sha256: string }[] }
export type ContinuationReaders = {
  previous: () => ContinuationPredecessor | undefined
  agents: () => { current: AgentIdentity; previous: AgentIdentity | undefined }
  version: () => Promise<string | null>
  accounts: () => { current: string | null; previous: string | undefined }
  manifests: () => { current: Contract | undefined; previous: Contract | undefined }
  thread: () => Promise<string | undefined>
  originStartedAt: (seq: number) => number
  recordExists: (home: string, id: string, startedAt: number) => Promise<boolean>
  worktree: (
    previous: ContinuationPredecessor,
    preservation: z.infer<typeof AttemptPreservedAuditSchema>
  ) => Promise<ContinuationWorktree | undefined>
}
const Interrupted = z.object({
  settlement: z.object({ kind: z.literal('interrupted') }),
  reason: z.string().optional(),
  evidence: z.string().optional(),
  exitCode: z.unknown().optional(),
  providerSessionId: z.unknown().optional()
})

function sameContract(a: Contract, b: Contract) {
  return (
    a.planRevisionId === b.planRevisionId &&
    a.mandatory.length === b.mandatory.length &&
    a.mandatory.every(
      (section, index) =>
        section.section === b.mandatory[index].section &&
        (section.section === 'Previous-Attempt failure evidence' ||
          section.sha256 === b.mandatory[index].sha256)
    )
  )
}

/** Ordered rules consume host evidence lazily: a later read cannot mask an earlier reason. */
export async function decideInPlaceContinuation(
  taskId: string,
  baseline: AttemptBaseline,
  read: ContinuationReaders
): Promise<ContinuationDecision> {
  const fresh = (reason: FreshSessionReason): FreshSession => ({ strategy: 'fresh', reason })
  try {
    const previous = read.previous()
    const failed = Interrupted.safeParse(previous?.failure)
    if (!previous || previous.stopped || previous.submitted || !failed.success) {
      return fresh('not_interrupted')
    }
    const failure = failed.data
    if (failure.reason === 'resume_refused') {
      return fresh('resume_refused')
    }
    if (
      !(failure.evidence === 'exit_code' && Number.isInteger(failure.exitCode)) &&
      !(failure.reason === 'process_exited' && failure.evidence === 'runtime_restarted')
    ) {
      return fresh('no_exit_evidence')
    }
    const preservation = AttemptPreservedAuditSchema.safeParse(previous.preservation)
    if (
      !preservation.success ||
      preservation.data.taskId !== taskId ||
      preservation.data.result.status === 'unavailable' ||
      (preservation.data.result.status === 'preserved' &&
        (baseline.kind !== 'snapshot' || baseline.previousSeq !== previous.seq))
    ) {
      return fresh('snapshot_unusable')
    }
    const agents = read.agents()
    if (!agents.previous) {
      return fresh('evidence_unreadable')
    }
    if (
      agents.current.provider !== agents.previous.provider ||
      agents.current.model !== agents.previous.model ||
      agents.current.reasoning.effort !== agents.previous.reasoning.effort
    ) {
      return fresh('agent_changed')
    }
    const version = await read.version()
    if (
      !version ||
      !certifiedCombo(agents.current.provider)?.sessionResume?.harnessVersions.includes(version)
    ) {
      return fresh('capability_unproven')
    }
    const accounts = read.accounts()
    if (!accounts.current || !accounts.previous) {
      return fresh('evidence_unreadable')
    }
    if (accounts.current !== accounts.previous) {
      return fresh('account_changed')
    }
    const manifests = read.manifests()
    if (!manifests.current || !manifests.previous) {
      return fresh('evidence_unreadable')
    }
    if (!sameContract(manifests.current, manifests.previous)) {
      return fresh('contract_changed')
    }
    const auditedId = CodexThreadId.safeParse(failure.providerSessionId)
    const id = CodexThreadId.safeParse(auditedId.success ? auditedId.data : await read.thread())
    if (!id.success || (previous.session && previous.session.id !== id.data)) {
      return fresh('session_unknown')
    }
    const originSeq = previous.session?.originSeq ?? previous.seq
    if (originSeq > previous.seq) {
      return fresh('session_unknown')
    }
    const startedAt = read.originStartedAt(originSeq)
    if (!Number.isFinite(startedAt)) {
      return fresh('evidence_unreadable')
    }
    if (!(await read.recordExists(accounts.current, id.data, startedAt))) {
      return fresh('session_record_missing')
    }
    const worktree = await read.worktree(previous, preservation.data)
    if (!worktree) {
      return fresh('worktree_changed')
    }
    const ending = readEnding(previous.failure, undefined)
    if (!ending) {
      return fresh('evidence_unreadable')
    }
    return {
      strategy: 'resumed_in_place',
      id: id.data,
      originSeq,
      fromSeq: previous.seq,
      ...worktree,
      preserved: preservation.data.result.status === 'preserved',
      ending
    }
  } catch {
    return fresh('evidence_unreadable')
  }
}

export function continuationSession(decision: ContinuationDecision): ResumedSession | FreshSession {
  if (decision.strategy === 'fresh') {
    return decision
  }
  const { strategy, id, originSeq, fromSeq } = decision
  return { strategy, id, originSeq, fromSeq }
}
