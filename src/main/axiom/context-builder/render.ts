import { readTokenBudgets, tokenBudgetLines } from './token-budget'
import {
  VerificationRulesSchema,
  resolveVerificationPlan
} from '../../../shared/axiom-contract/verification-rules'
import type { AxiomStore } from '../db/axiom-store'
import { resolveAcceptance } from '../../../shared/axiom-contract/acceptance'
import { readRepositoryRules } from './repository-rules'
import { redactContext } from './redaction'
import { z } from 'zod'
import { HeadlessSubmissionReportSchema } from '../../../shared/axiom-contract/submission-params'
import { answeredQuestions } from './answered-questions'

export type ContextSection = { section: string; source: string; text: string }

export function markdownSection(section: string, content: string): string {
  return `## ${section}\n\n${content}\n`
}

export function workerProtocol(
  missionId: string,
  taskId: string,
  channel: 'tui' | 'headless' = 'tui',
  provider = 'codex'
): string {
  const selfChecks = [
    'Before finishing, run the commands under "Required verification commands" that can run in this worktree, then re-read the complete diff against acceptanceCriteria and the repository rules (AGENTS.md, CLAUDE.md and REVIEW.md where present).',
    'List every check not run in checksRun with result: "skipped" and a note; checksRun never decides the verdict.',
    "Use only this worktree's own toolchain: never symlink, copy or borrow node_modules, .bin or caches from any other directory; when dependencies are missing, say so in limitations."
  ]
  if (channel === 'headless') {
    return markdownSection(
      'Axiom Worker protocol',
      [
        `Mission: ${missionId}\nTask: ${taskId}\nAttempt: {{attemptId}}`,
        'Work and test in the Attempt worktree. The host snapshots and submits your work after this process exits.',
        ...(provider === 'claude'
          ? [
              'Read AGENTS.md and CLAUDE.md at the worktree root before changing anything; they are not auto-loaded in isolation mode. The Worker does not need the axiom CLI; the host submits on exit.'
            ]
          : []),
        'The sandbox has no network and an empty package store, so do not try to install dependencies; verification runs the Mission’s setup commands.',
        ...selfChecks,
        'Set outcome to {"outcome":"submitted"} when the tree contains the change.',
        'Set outcome to {"outcome":"no_change","reason":"candidate_already_correct"} when the failing check is wrong about this tree, or use reason "cannot_reproduce" when the failure does not occur here; in both cases change nothing and explain in summary.',
        'Set outcome to {"outcome":"blocked","reason":"blocked_by_scope","paths":["exact/path"]} when failing checks can only be fixed outside allowedPaths; stop, do not edit outside allowedPaths, and do not submit an unchanged tree as submitted.',
        'Never spawn Workers or mark Tasks verified, integrated, or complete. A submission is a report, not verification.',
        'Write non-code deliverables and required evidence under .axiom/artifacts/ and list their paths, kinds and media types in artifacts. The host stores and attributes them; .axiom/ is excluded from the Candidate.',
        'If your context gets compacted, re-read .axiom/prompt.md before continuing: this prompt is the recovery point for this Attempt.',
        'Put questions, blockers, limitations, risks and suggested follow-ups in the report. Do not call the Control Plane CLI.',
        'End your final message with exactly one fenced ```json block matching this schema. The host computes the Candidate and filesChanged.',
        '```json',
        JSON.stringify(z.toJSONSchema(HeadlessSubmissionReportSchema), null, 2),
        '```'
      ].join('\n\n')
    )
  }
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
      ...selfChecks,
      'If the failing check is wrong about this tree (candidate_already_correct), cannot be reproduced (cannot_reproduce), or requires files outside allowedPaths (blocked_by_scope), report the conclusion before stopping with axiom attempt blocked --attempt {{attemptId}} --reason <reason> --summary <explanation> and repeat --path <exact/path> for the out-of-scope files; do not edit outside allowedPaths.',
      '',
      '```sh',
      ...verbs.map(
        (verb) =>
          `axiom attempt ${verb} --attempt {{attemptId}}${verb === 'submit' ? ' --report <path.json>' : ''}`
      ),
      `axiom mission artifact put --attempt {{attemptId}} --mission ${missionId} --kind <kind> --file <path> --related ${taskId}`,
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

export async function mandatorySections(
  store: AxiomStore,
  missionId: string,
  taskId: string,
  previousAttempt: { source: string; content: string },
  channel: 'tui' | 'headless' = 'tui',
  provider = 'codex'
) {
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
  const { title, objective, scope, risk, retryPolicy } = task.spec
  const acceptanceCriteria = resolveAcceptance(task.spec)
  const rules = VerificationRulesSchema.safeParse(policy.verificationRules)
  const verificationCommands = rules.success
    ? resolveVerificationPlan(task.spec, rules.data)
        .map(({ command }) => command)
        .join('\n') || 'none configured'
    : 'Verification rules are invalid (policy_invalid); the independent verifier will escalate to a human.'
  const decisions = store.listDecisions({ missionId, status: 'ACCEPTED' })
  const protocol = workerProtocol(missionId, taskId, channel, provider)
  const tokenLines =
    channel === 'headless' ? tokenBudgetLines(readTokenBudgets(store, missionId, taskId)) : []
  const entries = [
    {
      section: 'Task spec',
      source: `task:${taskId}`,
      content: json({
        title,
        objective,
        scope,
        acceptanceCriteria,
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
        channel === 'headless'
          ? 'The host computes the Candidate and changed files. Keep reports and other Artifacts under .axiom/artifacts/; .axiom/ never enters the Candidate.'
          : 'Every file left in this worktree becomes part of the Candidate. Write reports and other Artifact files outside the worktree (for example in a temporary directory) before running axiom mission artifact put.',
        'Verification compares the Candidate with its merge-base on the integration branch: a changed path outside allowedPaths fails it (scope_violation), an added line that matches a secret pattern fails it (secret_detected), and changes to dependency manifests, lockfiles, CI, hooks, test or lint configuration or agent instruction files go to human review unless an allowedPaths entry names them.',
        'Deleting or skipping tests, removing assertions from a test file, or adding lint, type-check or coverage suppressions sends the Candidate to human review (test_tampering). When the Task has no command criterion, reference at least one readable, non-empty Artifact in the submission (JSON must parse); a person confirms it.',
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
    ...(tokenLines.length
      ? [
          {
            section: 'Token budget',
            source: `token-usage:${taskId}`,
            content: tokenLines.join('\n')
          }
        ]
      : []),
    {
      section: 'Repository rules',
      source: `repository:${mission.targetBranch}`,
      content: await readRepositoryRules(mission.repoPath, mission.targetBranch)
    },
    {
      section: 'Required verification commands',
      source: `verification:${missionId}`,
      content: verificationCommands
    },
    {
      section: 'Previous-Attempt failure evidence',
      ...previousAttempt
    },
    {
      section: 'Answered questions',
      ...answeredQuestions(store, missionId, taskId)
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
