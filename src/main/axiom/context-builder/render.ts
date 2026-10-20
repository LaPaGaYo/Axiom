import { z } from 'zod'
import type { AxiomStore } from '../db/axiom-store'
import { readRepositoryRules } from './repository-rules'
import { redactContext } from './redaction'

export type ContextSection = { section: string; source: string; text: string }

export function markdownSection(section: string, content: string): string {
  return `## ${section}\n\n${content}\n`
}

export function workerProtocol(missionId: string, taskId: string): string {
  const verbs = [
    'submit',
    'ask',
    'blocked',
    'handoff',
    'inform',
    'request',
    'request-subtask',
    'check'
  ]
  return markdownSection(
    'Axiom Worker protocol',
    [
      'Use only the Axiom CLI to communicate with the Control Plane. Add the verb-specific payload to each command.',
      'Never spawn Workers or mark Tasks verified, integrated, or complete. A submission is a report, not verification.',
      '',
      '```sh',
      ...verbs.map(
        (verb) =>
          `axiom attempt ${verb} --attempt {{attemptId}} --dispatch-capability {{dispatchCapability}}${verb === 'submit' ? ' --report <path.json>' : ''}`
      ),
      `axiom mission artifact put --mission ${missionId} --kind <kind> --file <path> --related ${taskId}`,
      '```'
    ].join('\n')
  )
}

function json(value: unknown): string {
  // All callers supply validated JSON; sort record keys as well as schema object keys.
  return JSON.stringify(
    value,
    (_key, entry: unknown) =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : entry,
    2
  )
}

export async function mandatorySections(store: AxiomStore, missionId: string, taskId: string) {
  const mission = store.getMission(missionId)
  const task = store.getTaskStage(taskId)
  if (!mission) {
    throw new Error('mission_not_found')
  }
  if (!task) {
    throw new Error('task_not_found')
  }
  if (task.missionId !== missionId) {
    throw new Error('task_mission_mismatch')
  }
  const plan = store.getPlanRevision(task.planRevisionId)
  const policy = store.getPolicy(missionId)
  if (!plan || plan.missionId !== missionId) {
    throw new Error('plan_revision_not_found')
  }
  if (!policy) {
    throw new Error('mission_policy_not_found')
  }
  const incoming = store.listUpstreamEdges(taskId)
  const outgoing = store.listDownstreamEdges(taskId)
  function neighbour(id: string) {
    const value = store.getTaskStage(id)
    if (!value || value.missionId !== missionId || value.planRevisionId !== plan?.id) {
      throw new Error('context_dependency_mismatch')
    }
    return { taskId: id, title: value.spec.title }
  }
  const { title, objective, scope, acceptanceCriteria, requiredEvidence, risk, retryPolicy } =
    task.spec
  const commands = z.array(z.string()).parse(policy.verificationRules.commands ?? [])
  const decisions = store.listDecisions({ missionId, status: 'ACCEPTED' })
  const protocol = workerProtocol(missionId, taskId)
  const entries = [
    {
      section: 'Task spec',
      source: `task:${taskId}`,
      content: json({
        title,
        objective,
        scope,
        acceptanceCriteria,
        requiredEvidence,
        risk,
        retryPolicy
      })
    },
    {
      section: 'PlanRevision summary',
      source: `plan:${plan.id}`,
      content: json({
        revision: plan.revision,
        milestone: plan.milestones.find((m) => m.id === task.spec.milestoneId) ?? null,
        incoming: incoming.map((edge) => ({
          ...neighbour(edge.fromTaskId),
          readinessThreshold: edge.readinessThreshold
        })),
        outgoing: outgoing.map((edge) => ({
          ...neighbour(edge.toTaskId),
          readinessThreshold: edge.readinessThreshold
        }))
      })
    },
    {
      section: 'ACCEPTED Decisions',
      source: `decisions:${missionId}`,
      content: decisions.length
        ? json(decisions.map(({ title, resolution }) => ({ title, resolution })))
        : 'none'
    },
    {
      section: 'Permissions, budget and submission contract',
      source: `policy:${missionId}`,
      content: [
        json({
          allowedPaths: scope.allowedPaths,
          risk,
          retryPolicy,
          taskBudget: task.spec.budget ?? {},
          missionBudget: policy.budget,
          contextTokens: store.getContextTokenBudget(missionId) ?? 24_000,
          concurrencyLimit: policy.concurrencyLimit,
          approvalRules: policy.approvalRules,
          nestedWorkerMaxDepth: policy.nestedWorkerMaxDepth
        }),
        'Write only within allowedPaths. No permission, credential, network or budget expansion without Control Plane authorization.',
        'Write scope is checked by verification-time diff inspection; CLI agents have no runtime write-scope enforcement.',
        'Submission contract: axiom-submission-v1',
        '- Task and Attempt identifiers',
        '- Concise implementation summary',
        '- Files changed',
        '- Tests and checks run with results',
        '- Produced Artifacts',
        '- Known limitations and risks',
        '- Unresolved questions',
        '- Suggested follow-up work'
      ].join('\n')
    },
    {
      section: 'Repository rules',
      source: `repository:${mission.targetBranch}`,
      content: await readRepositoryRules(mission.repoPath, mission.targetBranch)
    },
    {
      section: 'Required verification commands',
      source: `verification:${missionId}`,
      content: commands.length ? commands.join('\n') : 'none configured'
    },
    {
      section: 'Previous-Attempt failure evidence',
      source: 'previous-attempt:m2',
      content: 'none (first attempt)'
    }
  ]
  const sections: ContextSection[] = entries.map(({ section, source, content }) => {
    const safe = redactContext(content)
    return {
      section,
      source,
      text: markdownSection(section, `${safe.redacted ? '[redacted]\n' : ''}${safe.content}`)
    }
  })
  return { task, incoming, sections, protocol }
}
