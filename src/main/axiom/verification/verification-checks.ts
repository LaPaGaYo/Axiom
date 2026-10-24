import type { Repo } from '../../../shared/repo-types'
import { isRepoOnCatalogHost } from '../../../shared/execution-host'
import type { VerificationRunStatus } from '../../../shared/axiom-contract/lifecycle'
import type { VerificationRun } from '../../../shared/axiom-contract/verification-params'
import {
  VerificationRulesSchema,
  resolveVerificationPlan
} from '../../../shared/axiom-contract/verification-rules'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import { redactContext } from '../context-builder/redaction'
import type { VerificationDependencies } from './verification-service'
import { executeVerificationPlan } from './verification-plan-runner'
import { decideVerificationVerdict, type VerificationVerdict } from './verification-verdict'
import { removeVerificationWorktree } from './verification-worktree'
import { VerificationInterrupted, settleVerificationVerdict } from './verification-settlement'
import { readCandidateDiff } from './candidate-diff'
import { evaluateDiffGate, summarizeDiffGate, type DiffGate } from './diff-gate'

export function isLocalVerificationRepository(
  repo: Pick<Repo, 'connectionId' | 'executionHostId'>
): boolean {
  return isRepoOnCatalogHost(repo)
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
    let gate: DiffGate | undefined
    let diffSummary: ReturnType<typeof summarizeDiffGate> | undefined
    let diffEvidence: ReturnType<typeof summarizeDiffGate> | undefined
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
      const candidate = store.getCandidate(run.candidateId)
      if (!candidate) {
        throw new VerificationInterrupted()
      }
      const diff = await readCandidateDiff({
        cwd,
        missionId: run.missionId,
        candidateCommitSha: candidate.commitSha
      })
      assertCurrent()
      gate = evaluateDiffGate({ diff, allowedPaths: task.spec.scope.allowedPaths, rules })
      diffSummary = summarizeDiffGate(diff, gate, 50)
      diffEvidence = summarizeDiffGate(diff, gate, 1000)
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
      verdict = decideVerificationVerdict(result.checks, rules, gate)
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
          ...(diffEvidence ? { diff: diffEvidence } : {}),
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
      ...(diffSummary ? { diff: diffSummary } : {}),
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
    const settled = settleVerificationVerdict(deps, {
      run,
      verdict,
      result,
      verdictDetail,
      finishedAt,
      commands,
      gate
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
