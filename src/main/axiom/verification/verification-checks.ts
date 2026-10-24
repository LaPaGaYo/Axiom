import type { Repo } from '../../../shared/repo-types'
import type { VerificationRunStatus } from '../../../shared/axiom-contract/lifecycle'
import type { VerificationRun } from '../../../shared/axiom-contract/verification-params'
import {
  VerificationRulesSchema,
  resolveVerificationPlan
} from '../../../shared/axiom-contract/verification-rules'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import { redactContext } from '../context-builder/redaction'
import { settleVerificationFailure } from '../execution/attempt-settlement'
import type { VerificationDependencies } from './verification-service'
import { auditVerification } from './verification-claim'
import { executeVerificationPlan } from './verification-plan-runner'
import { decideVerificationVerdict, type VerificationVerdict } from './verification-verdict'
import { removeVerificationWorktree } from './verification-worktree'

class VerificationInterrupted extends Error {}

export function isLocalVerificationRepository(
  repo: Pick<Repo, 'connectionId' | 'executionHostId'>
): boolean {
  return !repo.connectionId && (!repo.executionHostId || repo.executionHostId === 'local')
}

async function cleanupVerification(
  deps: VerificationDependencies,
  run: VerificationRun,
  expectedStatus: VerificationRunStatus
) {
  if (!run.worktreeId) {
    return
  }
  let cleanupPending = false
  try {
    await removeVerificationWorktree(deps.runtime, run.worktreeId)
  } catch {
    cleanupPending = true
  }
  const current = deps.store.getVerificationRun(run.id)
  // An obsolete claim may remove its own tree, but cannot update a newer run's metadata.
  if (
    !current ||
    current.status !== expectedStatus ||
    current.worktreeId !== run.worktreeId ||
    current.runtimeEpoch !== run.runtimeEpoch ||
    current.claimCount !== run.claimCount
  ) {
    return
  }
  deps.store.updateVerificationRun({
    id: run.id,
    expectedStatus,
    expectedRuntimeEpoch: run.runtimeEpoch,
    expectedClaimCount: run.claimCount,
    worktreeId: cleanupPending ? run.worktreeId : null,
    verdictDetail: { ...current.verdictDetail, cleanupPending }
  })
}

export async function runVerificationChecks(
  deps: VerificationDependencies,
  run: VerificationRun,
  signal?: AbortSignal
): Promise<void> {
  const { store, missions, artifacts, runtime, runtimeEpoch } = deps
  const fence = {
    id: run.id,
    expectedStatus: 'RUNNING' as const,
    expectedRuntimeEpoch: runtimeEpoch,
    expectedClaimCount: run.claimCount
  }
  const assertCurrent = () => {
    const current = store.getVerificationRun(run.id)
    if (
      signal?.aborted ||
      current?.status !== 'RUNNING' ||
      current.runtimeEpoch !== runtimeEpoch ||
      current.claimCount !== run.claimCount
    ) {
      throw new VerificationInterrupted()
    }
  }
  let cleanupStatus: VerificationRunStatus = 'RUNNING'
  try {
    assertCurrent()
    const task = store.getTaskStage(run.taskId)
    if (!task) {
      throw new VerificationInterrupted()
    }
    const parsed = VerificationRulesSchema.safeParse(
      store.getPolicy(run.missionId)?.verificationRules
    )
    const rules = parsed.success ? parsed.data : VerificationRulesSchema.parse({})
    const plan = parsed.success ? resolveVerificationPlan(task.spec, rules) : []
    const started = Date.now()
    const deadline = started + rules.timeBudgetMinutes * 60_000
    const commands = plan.map(({ command }) => redactContext(command).content)
    const repo = await runtime.showRepo(`id:${missions.getMission(run.missionId).repoId}`)
    assertCurrent()
    if (
      !store.updateVerificationRun({
        ...fence,
        commands,
        verdictDetail: { ...run.verdictDetail, phase: 'checking' }
      })
    ) {
      return
    }
    let result: Awaited<ReturnType<typeof executeVerificationPlan>> = {
      checks: [],
      tools: [],
      toolVersions: {}
    }
    let verdict: VerificationVerdict
    if (!parsed.success) {
      verdict = { verdict: 'INCONCLUSIVE', reason: 'policy_invalid', escalation: 'human' }
    } else if (!isLocalVerificationRepository(repo)) {
      verdict = {
        verdict: 'INCONCLUSIVE',
        reason: 'environment',
        escalation: 'human',
        detail: 'remote_repository_unsupported'
      }
    } else {
      const cwd = run.worktreeId && splitWorktreeIdForFilesystem(run.worktreeId)?.worktreePath
      if (!cwd) {
        throw new VerificationInterrupted()
      }
      result = await executeVerificationPlan({
        artifacts,
        run,
        plan,
        rules,
        cwd,
        deadline,
        signal,
        assertCurrent
      })
      verdict = decideVerificationVerdict(result.checks, rules)
    }
    assertCurrent()
    const finishedAt = new Date().toISOString()
    const evidence = await artifacts.put({
      missionId: run.missionId,
      kind: 'evidence',
      mediaType: 'application/json',
      createdBy: 'VerificationService',
      related: [run.id, run.taskId, run.candidateId],
      content: Buffer.from(
        JSON.stringify({
          ...verdict,
          ...result,
          runId: run.id,
          taskId: run.taskId,
          candidateId: run.candidateId,
          runtimeEpoch,
          claim: run.claimCount,
          deadline: new Date(deadline).toISOString(),
          startedAt: new Date(started).toISOString(),
          finishedAt
        })
      )
    })
    assertCurrent()
    const previousEvidence = Array.isArray(run.verdictDetail.evidenceArtifactIds)
      ? run.verdictDetail.evidenceArtifactIds.filter((id): id is string => typeof id === 'string')
      : []
    const verdictDetail = {
      phase: 'verdict',
      ...verdict,
      verdictArtifactId: evidence.id,
      evidenceArtifactIds: [...previousEvidence, evidence.id],
      checks: result.checks.map(
        ({ index, source, command, result, reason, exitCode, durationMs, failures }) => ({
          index,
          source,
          command,
          result,
          ...(reason ? { reason } : {}),
          exitCode,
          durationMs,
          failures
        })
      )
    }
    const settled = store.transaction('verification_verdict', () => {
      const candidate = store.getCandidate(run.candidateId)
      if (
        store.getTaskStage(run.taskId)?.stage !== 'VERIFYING' ||
        candidate?.status !== 'ACTIVE' ||
        candidate.taskId !== run.taskId ||
        candidate.missionId !== run.missionId
      ) {
        return
      }
      if (
        !store.updateVerificationRun({
          ...fence,
          status: verdict.verdict,
          finishedAt,
          commands,
          toolVersions: result.toolVersions,
          verdictDetail
        })
      ) {
        return
      }
      if (verdict.verdict === 'PASS') {
        missions.transitionTaskStage({
          taskId: run.taskId,
          to: 'VERIFIED',
          actor: 'VerificationService',
          reason: 'verification_passed'
        })
      } else if (verdict.verdict === 'FAIL' && !settleVerificationFailure(deps, run).settled) {
        throw new VerificationInterrupted()
      }
      for (const check of result.checks.filter((check) => check.reason === 'known_flaky')) {
        auditVerification(deps, run, 'verification.known_flaky', {
          checkIndex: check.index,
          failures: check.failures
        })
      }
      auditVerification(
        deps,
        run,
        verdict.verdict === 'PASS'
          ? 'verification.passed'
          : verdict.verdict === 'FAIL'
            ? 'verification.failed'
            : 'verification.inconclusive',
        {
          ...verdict,
          ...(verdict.verdict === 'FAIL'
            ? {
                failures: result.checks
                  .filter((c) => c.result === 'fail')
                  .flatMap((c) => c.failures)
              }
            : {})
        }
      )
      return true
    })
    if (settled) {
      cleanupStatus = verdict.verdict
    }
  } catch (error) {
    if (!(error instanceof VerificationInterrupted)) {
      throw error
    }
  } finally {
    // Shutdown leaves the RUNNING claim for boot recovery, after its process tree has stopped.
    if (!signal?.aborted) {
      await cleanupVerification(deps, run, cleanupStatus)
    }
  }
}
