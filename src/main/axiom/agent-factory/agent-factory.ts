import type { ContextBuilder } from '../context-builder/context-builder'
import { hasHeadlessWorkerBuilder } from '../execution/headless-worker-command'
import { z } from 'zod'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import { AgentSpecSchema, type AgentSpec } from '../../../shared/axiom-contract/agent-spec'
import { isTuiAgent } from '../../../shared/tui-agent-config'
import type { AxiomStore } from '../db/axiom-store'
import type { DecisionEngine } from '../decision-engine/decision-engine'
import { AgentFactoryError, selectProvider } from './provider-selection'
export { AgentFactoryError } from './provider-selection'

const BuildParams = z.discriminatedUnion('role', [
  z.strictObject({
    missionId: AxiomIdSchema,
    role: z.literal('worker'),
    taskId: AxiomIdSchema,
    contextPackageId: AxiomIdSchema
  }),
  z.strictObject({
    missionId: AxiomIdSchema,
    role: z.literal('planner'),
    goalRevisionId: AxiomIdSchema
  })
])

function plannerProvider(store: AxiomStore, missionId: string): AgentSpec['provider'] | null {
  const mission = store.getMission(missionId)
  const plan = mission?.activePlanRevisionId
    ? store.getPlanRevision(mission.activePlanRevisionId)
    : undefined
  if (
    plan?.missionId === missionId &&
    plan.status === 'APPROVED' &&
    isTuiAgent(plan.provenance.actor)
  ) {
    return plan.provenance.actor
  }
  const specs = store.listAgentSpecs(missionId).filter((record) => record.spec.role === 'planner')
  const newest = specs.at(-1)
  const tied = specs.filter((record) => record.createdAt === newest?.createdAt)
  // SQLite timestamps have second precision; creation audits break ties without trusting hash order.
  const latestAudit =
    tied.length > 1
      ? store
          .listAuditEvents({ missionId })
          .findLast(
            (event) =>
              event.event === 'agent_spec.created' &&
              tied.some((record) => record.id === event.objectId)
          )
      : undefined
  return (
    (tied.find((record) => record.id === latestAudit?.objectId) ?? newest)?.spec.provider ?? null
  )
}

export class AgentFactory {
  constructor(
    private readonly store: AxiomStore,
    private readonly engine: DecisionEngine,
    private readonly listInstalledProviders: () => Promise<string[]>,
    private readonly hasAccount: (provider: string) => boolean = () => true
  ) {}

  async selectWorkerProvider(input: { missionId: string; taskId: string }): Promise<string> {
    const { missionId, taskId } = z
      .object({ missionId: AxiomIdSchema, taskId: AxiomIdSchema })
      .parse(input)
    const installed = await this.listInstalledProviders()
    const policy = this.store.getPolicy(missionId)
    if (!this.store.getMission(missionId) || !policy) {
      throw new AgentFactoryError('mission_not_found', { missionId })
    }
    const task = this.store.getTaskStage(taskId)
    if (!task || task.missionId !== missionId) {
      throw new AgentFactoryError('task_not_found', { taskId })
    }
    return selectProvider(
      installed,
      policy.routing,
      'worker',
      task.spec.risk,
      this.engine,
      this.hasAccount,
      plannerProvider(this.store, missionId)
    ).chosen
  }

  async build(input: z.input<typeof BuildParams>) {
    const p = BuildParams.parse(input)
    const installed = await this.listInstalledProviders()
    // Read policy and Task after host discovery, without an await inside the atomic write.
    return this.store.transaction('agent_spec', () => {
      const policy = this.store.getPolicy(p.missionId)
      if (!this.store.getMission(p.missionId) || !policy) {
        throw new AgentFactoryError('mission_not_found', { missionId: p.missionId })
      }
      const task = p.role === 'worker' ? this.store.getTaskStage(p.taskId) : undefined
      if (p.role === 'worker') {
        if (!task || task.missionId !== p.missionId) {
          throw new AgentFactoryError('task_not_found', { taskId: p.taskId })
        }
        const context = this.store.getContextPackage(p.contextPackageId)
        if (!context || context.missionId !== p.missionId || context.taskId !== p.taskId) {
          throw new AgentFactoryError('invalid_argument', { reason: 'context_package_mismatch' })
        }
      } else {
        const goal = this.store.getGoalRevision(p.goalRevisionId)
        if (!goal || goal.missionId !== p.missionId) {
          throw new AgentFactoryError('goal_revision_not_found', {
            goalRevisionId: p.goalRevisionId
          })
        }
      }
      const highRisk = task?.spec.risk === 'high'
      const selection = selectProvider(
        installed,
        policy.routing,
        p.role,
        task?.spec.risk ?? 'high',
        this.engine,
        this.hasAccount,
        p.role === 'worker' ? plannerProvider(this.store, p.missionId) : null
      )
      const roleRouting = policy.routing.roles[p.role]
      const maxTokens = task?.spec.budget?.maxTokens ?? policy.budget.maxTokens
      const spec = AgentSpecSchema.parse({
        version: 1,
        missionId: p.missionId,
        provider: selection.chosen,
        model: roleRouting?.model ?? policy.routing.models[selection.chosen] ?? 'policy-default',
        endpointProfile: 'subscription',
        reasoning: {
          effort: roleRouting?.effort ?? (p.role === 'planner' || highRisk ? 'high' : 'medium')
        },
        permissions: {
          write: task?.spec.scope.allowedPaths ?? [],
          network: 'restricted',
          tools: ['shell', 'git-readonly']
        },
        budget: {
          maxRuntimeMinutes:
            task?.spec.budget?.maxRuntimeMinutes ?? policy.budget.maxRuntimeMinutes ?? 45,
          ...(maxTokens === undefined ? {} : { maxTokens })
        },
        submissionContract: 'axiom-submission-v1',
        selection,
        ...(p.role === 'worker'
          ? {
              role: p.role,
              taskId: p.taskId,
              contextPackageId: p.contextPackageId,
              acceptanceCriteria: task?.spec.acceptanceCriteria,
              capabilities: [
                ...new Set(
                  task?.spec.scope.allowedPaths
                    .map((value) => value.split(/[\\/]/).find(Boolean))
                    .filter(Boolean)
                )
              ].sort(),
              workspace: { strategy: 'attempt-worktree' }
            }
          : {
              role: p.role,
              goalRevisionId: p.goalRevisionId,
              capabilities: ['planning'],
              workspace: { strategy: 'planner-worktree' }
            })
      })
      const { id, inserted } = this.store.insertAgentSpec(spec)
      if (inserted) {
        this.store.appendAuditEvent({
          missionId: p.missionId,
          actor: 'AgentFactory',
          objectKind: 'agent_spec',
          objectId: id,
          event: 'agent_spec.created',
          before: null,
          after: selection
        })
      }
      return { id, spec }
    })
  }
}

export async function buildWorkerContracts(
  contextBuilder: ContextBuilder,
  agentFactory: AgentFactory,
  missionId: string,
  taskId: string
) {
  const provider = await agentFactory.selectWorkerProvider({ missionId, taskId })
  const context = await contextBuilder.build({
    missionId,
    taskId,
    provider,
    channel: hasHeadlessWorkerBuilder(provider) ? 'headless' : 'tui'
  })
  const agent = await agentFactory.build({
    missionId,
    taskId,
    role: 'worker',
    contextPackageId: context.packageId
  })
  if (agent.spec.provider !== provider) {
    throw new Error('Worker provider changed during admission')
  }
  return { agentSpecId: agent.id, contextPackageId: context.packageId }
}
