import type { CommandHandler } from '../../dispatch'
import { getRequiredStringFlag as required, getOptionalStringFlag as optional } from '../../flags'
import { formatPlan, formatPlanList } from '../../axiom-format'
import { readPlanFile, readPlannerPlanFile } from './input-files'
import { callAxiom } from './rpc-command'
import { callOrchestrationMutation } from '../orchestration/mutation-request'
import { resolveOrchestrationTerminalHandle } from '../orchestration/terminal-identity'
import { printResult } from '../../format'
import type { PlanResponse } from '../../../shared/axiom-contract/plan-params'

export const AXIOM_PLAN_HANDLERS: Record<string, CommandHandler> = {
  'plan propose': async (ctx) => {
    const missionId = required(ctx.flags, 'mission')
    const attemptId = optional(ctx.flags, 'attempt')
    if (attemptId) {
      const planRevision = await readPlannerPlanFile(ctx.cwd, required(ctx.flags, 'file'))
      const from = await resolveOrchestrationTerminalHandle(ctx.flags, ctx.cwd, ctx.client, 'from')
      const result = await callOrchestrationMutation<PlanResponse>(
        ctx.client,
        ctx.flags,
        'axiom.plan.propose',
        { missionId, planRevision, attemptId, from }
      )
      printResult(result, ctx.json, formatPlan)
      return
    }
    const { provenance, ...planRevision } = await readPlanFile(ctx.cwd, required(ctx.flags, 'file'))
    await callAxiom(ctx, 'axiom.plan.propose', { missionId, planRevision, provenance }, formatPlan)
  },
  'plan approve': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.plan.approve',
      { planRevisionId: required(ctx.flags, 'plan'), resolver: required(ctx.flags, 'resolver') },
      formatPlan
    )
  },
  'plan reject': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.plan.reject',
      {
        planRevisionId: required(ctx.flags, 'plan'),
        resolver: required(ctx.flags, 'resolver'),
        reason: required(ctx.flags, 'reason')
      },
      formatPlan
    )
  },
  'plan list': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.plan.list',
      { missionId: required(ctx.flags, 'mission') },
      formatPlanList
    )
  },
  'plan show': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.plan.show',
      { planRevisionId: required(ctx.flags, 'plan') },
      formatPlan
    )
  }
}
