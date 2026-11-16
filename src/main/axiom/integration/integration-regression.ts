import type { TaskStageRecord } from '../../../shared/axiom-contract/mission-objects'
import type { IntegrationBatch } from '../../../shared/axiom-contract/integration-batch'
import type { VerificationRun } from '../../../shared/axiom-contract/verification-params'
import {
  VerificationRulesSchema,
  resolveIntegrationPlan
} from '../../../shared/axiom-contract/verification-rules'
import { redactContext } from '../context-builder/redaction'
import { executeVerificationPlan } from '../verification/verification-plan-runner'
import {
  decideVerificationVerdict,
  type VerificationVerdict
} from '../verification/verification-verdict'
import type { ApplyEffect, IntegrationDependencies } from './integration-apply'
import { readIntegrationGit } from './integration-merge'
import {
  RegressionInterrupted,
  assertRegressionCurrent,
  cancelIntegrationRegression,
  startIntegrationRegression,
  settleIntegrationRegression
} from './integration-regression-state'

type RegressionInput = {
  batch: IntegrationBatch
  task: TaskStageRecord
  effect: ApplyEffect
  cwd: string
  signal: AbortSignal
}

export async function runIntegrationRegression(
  deps: IntegrationDependencies,
  input: RegressionInput
): Promise<'done' | 'stopped' | 'interrupted'> {
  const { store, artifacts } = deps
  const { batch, task, effect, cwd, signal } = input
  let run: VerificationRun | undefined
  let verdict: VerificationVerdict
  const assertCurrent = () => assertRegressionCurrent(store, batch, effect, signal, run)
  try {
    assertCurrent()
    const parsed = VerificationRulesSchema.safeParse(
      store.getPolicy(batch.missionId)?.verificationRules
    )
    const rules = parsed.success ? parsed.data : VerificationRulesSchema.parse({})
    const plan = parsed.success ? resolveIntegrationPlan(task.spec, rules) : []
    const commands = plan.map(({ command }) => redactContext(command).content)
    const baseline = {
      kind: 'integration_merge',
      batchId: batch.id,
      baseCommit: batch.baseCommit,
      mergeCommit: batch.mergeCommit
    }
    const started = Date.now()
    const startedAt = new Date(started).toISOString()
    const deadline = started + rules.timeBudgetMinutes * 60_000
    run = startIntegrationRegression({
      store,
      batch,
      effect,
      commands,
      baseline,
      startedAt,
      assertCurrent
    })
    const result = parsed.success
      ? await executeVerificationPlan({
          artifacts,
          run,
          plan,
          rules,
          cwd,
          deadline,
          signal,
          assertCurrent
        })
      : { checks: [], tools: [], toolVersions: {} }
    assertCurrent()
    const judged: VerificationVerdict = parsed.success
      ? decideVerificationVerdict(
          result.checks,
          rules,
          { outcome: 'clear' },
          false,
          {
            required: false,
            checked: [],
            counts: { checked: 0, unreadable: 0, empty: 0, invalid_utf8: 0, invalid_json: 0 }
          },
          []
        )
      : { verdict: 'INCONCLUSIVE', reason: 'policy_invalid' }
    // Regression has no human-review route, even when verification policy requests one.
    const { escalation: _escalation, ...withoutEscalation } = judged
    verdict = withoutEscalation
    let head: string | undefined
    try {
      head = (await readIntegrationGit(cwd, ['rev-parse', 'HEAD'])).trim()
    } catch {
      /* A missing HEAD cannot attest to the merge commit. */
    }
    if (head !== batch.mergeCommit) {
      verdict = { verdict: 'INCONCLUSIVE', reason: 'environment', detail: 'scratch_changed' }
    } else if (verdict.verdict === 'PASS' && !plan.length) {
      verdict = { ...verdict, detail: 'no_commands' }
    }
    assertCurrent()
    const finishedAt = new Date().toISOString()
    const evidence = await artifacts.put({
      missionId: batch.missionId,
      kind: 'evidence',
      mediaType: 'application/json',
      createdBy: 'IntegrationController',
      related: [run.id, run.taskId, run.candidateId, batch.id],
      content: Buffer.from(
        JSON.stringify({
          ...verdict,
          ...result,
          runId: run.id,
          taskId: run.taskId,
          candidateId: run.candidateId,
          batchId: batch.id,
          baseline,
          runtimeEpoch: run.runtimeEpoch,
          claim: run.claimCount,
          deadline: new Date(deadline).toISOString(),
          startedAt,
          finishedAt
        })
      )
    })
    settleIntegrationRegression(deps, {
      batch,
      run,
      verdict,
      commands,
      toolVersions: result.toolVersions,
      finishedAt,
      assertCurrent,
      verdictDetail: {
        phase: 'verdict',
        ...verdict,
        baseline,
        verdictArtifactId: evidence.id,
        evidenceArtifactIds: [evidence.id],
        checks: result.checks.map(
          ({
            index,
            source,
            command,
            criteria,
            result,
            reason,
            exitCode,
            durationMs,
            failures
          }) => ({
            index,
            source,
            command,
            criteria,
            result,
            ...(reason ? { reason } : {}),
            exitCode,
            durationMs,
            failures
          })
        )
      }
    })
  } catch (error) {
    if (error instanceof RegressionInterrupted) {
      if (error.kind === 'interrupted' && run) {
        try {
          const interrupted = run
          store.transaction('integration_regression_interrupted', () => {
            cancelIntegrationRegression(store, batch, interrupted, 'regression_interrupted')
          })
        } catch {
          throw new Error('regression_unavailable')
        }
      }
      return error.kind
    }
    // Commands and store errors may contain repository text; the outbox gets only a fixed code.
    throw new Error('regression_unavailable')
  }
  if (verdict.verdict === 'INCONCLUSIVE') {
    throw new Error('regression_inconclusive')
  }
  return 'done'
}
