import { useRef, useState } from 'react'
import type {
  AcceptanceCheck,
  AcceptanceCriterion,
  ArtifactKind,
  Policy,
  TaskSpec
} from '../../../../shared/axiom-contract/mission-objects'
import { resolveAcceptance } from '../../../../shared/axiom-contract/acceptance'
import { TaskAdjustParams } from '../../../../shared/axiom-contract/task-params'
import { validateTaskAcceptance } from '../../../../shared/axiom-contract/plan-proposal'
import {
  validateAcceptanceCommands,
  evidenceCommandMessage
} from '../../../../shared/axiom-contract/evidence-commands'
import { VerificationRulesSchema } from '../../../../shared/axiom-contract/verification-rules'

export type CriterionDraft = {
  key: number
  text: string
  kind: AcceptanceCheck['kind']
  command: string
  artifactKind?: ArtifactKind
}
export type CriterionIssue = { path: PropertyKey[]; message: string }

function criterionToSend(row: CriterionDraft): AcceptanceCriterion {
  const check: AcceptanceCheck =
    row.kind === 'command'
      ? { kind: 'command', command: row.command.trim() }
      : row.kind === 'artifact'
        ? { kind: 'artifact', ...(row.artifactKind ? { artifactKind: row.artifactKind } : {}) }
        : { kind: 'human' }
  return { text: row.text.trim(), check }
}

export function useTaskCriteriaDraft(spec: TaskSpec, policy?: Policy | null) {
  const [checked, setChecked] = useState(false)
  const [rows, setRows] = useState<CriterionDraft[] | null>(null)
  const nextKey = useRef(0)
  const retired = validateTaskAcceptance({ ...spec, acceptanceCriteria: resolveAcceptance(spec) }, [
    'task'
  ]).some((issue) => issue.code === 'required_evidence_retired')
  const enabled = checked && !retired
  const criteria = (rows ?? []).map(criterionToSend)
  const rules = policy ? VerificationRulesSchema.safeParse(policy.verificationRules) : null
  const issues: CriterionIssue[] = []
  if (enabled) {
    const parsed = TaskAdjustParams.shape.acceptanceCriteria.safeParse(criteria)
    if (!parsed.success) {
      issues.push(...parsed.error.issues.map(({ path, message }) => ({ path, message })))
    } else {
      const adjusted = { ...spec, acceptanceCriteria: criteria }
      issues.push(
        ...validateTaskAcceptance(adjusted, ['task']).map((issue) => ({
          path: issue.path?.slice(2) ?? [],
          message: issue.message
        }))
      )
      if (rules?.success) {
        issues.push(
          ...validateAcceptanceCommands(resolveAcceptance(adjusted), rules.data).map((issue) => ({
            path: [issue.index, 'check', 'command'],
            message: evidenceCommandMessage(issue, issue.command)
          }))
        )
      }
    }
  }
  return {
    checked: enabled,
    rows: rows ?? [],
    retired,
    issues,
    policyState: !policy ? 'unavailable' : rules?.success ? 'valid' : 'invalid',
    replacement: enabled ? { acceptanceCriteria: criteria } : {},
    toggle(value: boolean) {
      // Initialize once in the person's handler; rereads never replace an unsent draft.
      if (value && rows === null) {
        setRows(
          resolveAcceptance(spec).map(({ text, check }) => ({
            key: nextKey.current++,
            text,
            kind: check.kind,
            command: check.kind === 'command' ? check.command : '',
            artifactKind: check.kind === 'artifact' ? check.artifactKind : undefined
          }))
        )
      }
      setChecked(value)
    },
    add() {
      const row: CriterionDraft = { key: nextKey.current++, text: '', kind: 'command', command: '' }
      setRows((current) => [...(current ?? []), row])
    },
    update(key: number, change: Partial<Omit<CriterionDraft, 'key'>>) {
      setRows(
        (current) => current?.map((row) => (row.key === key ? { ...row, ...change } : row)) ?? null
      )
    },
    remove(key: number) {
      setRows((current) => current?.filter((row) => row.key !== key) ?? null)
    }
  }
}

export type TaskCriteriaDraft = ReturnType<typeof useTaskCriteriaDraft>
