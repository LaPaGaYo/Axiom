import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AXIOM_MESSAGE_TYPES,
  GOAL_REVISION_STATUSES,
  MISSION_STATUSES,
  PLAN_REVISION_STATUSES,
  READINESS_THRESHOLDS,
  REPLAN_LEVELS,
  RISK_LEVELS,
  TASK_DISPOSITIONS,
  TASK_STAGES,
  TERMINAL_MISSION_STATUSES,
  TERMINAL_TASK_STAGES,
  isLegalMissionTransition,
  isLegalTaskStageTransition
} from './lifecycle'

// This is the only contract test that reads docs; production contracts never read them.
const glossary = readFileSync(resolve('docs/GLOSSARY.md'), 'utf8')

function section(heading: string): string {
  const start = glossary.indexOf(heading)
  expect(start).toBeGreaterThanOrEqual(0)
  return glossary.slice(start + heading.length).split(/\n#{2,3} /)[0]
}

function fencedStates(heading: string): string[] {
  const block = section(heading).match(/```text\n([\s\S]*?)```/)
  expect(block).not.toBeNull()
  // Parenthesized explanations mention other objects' enums (Attempt FAILED, etc.).
  return block![1].replace(/（[^）]*）/g, '').match(/\b[A-Z][A-Z_]*\b/g) ?? []
}

function inlineStates(heading: string): string[] {
  return [...section(heading).matchAll(/`([^`]*→[^`]*)`/g)].flatMap(
    (match) => match[1].match(/\b[A-Z][A-Z_]*\b/g) ?? []
  )
}

function equalVocabulary(actual: readonly string[], documented: string[]): void {
  expect(actual.length).toBe(new Set(actual).size)
  expect([...actual].sort()).toEqual([...new Set(documented)].sort())
}

describe('glossary parity', () => {
  it('matches Mission §4.1, including interruption states after the parenthesis', () => {
    equalVocabulary(MISSION_STATUSES, fencedStates('### 4.1 Mission'))
  })
  it('matches GoalRevision §4.2 and PlanRevision §4.3', () => {
    equalVocabulary(GOAL_REVISION_STATUSES, inlineStates('### 4.2 GoalRevision'))
    equalVocabulary(PLAN_REVISION_STATUSES, inlineStates('### 4.3 PlanRevision'))
  })
  it('matches Task stage §4.4', () =>
    equalVocabulary(TASK_STAGES, fencedStates('### 4.4 Task stage')))
  it('matches replan and risk lists in §4.13', () => {
    const lines = section('### 4.13').split('\n')
    for (const [label, values] of [
      ['Replan 分级', REPLAN_LEVELS],
      ['风险等级', RISK_LEVELS]
    ] as const) {
      const list = lines.find((line) => line.includes(label))?.match(/`([^`]+)`/)
      expect(list).toBeDefined()
      equalVocabulary(values, list![1].split(/\s*\/\s*/))
    }
  })
  it('matches Task dispositions, readiness thresholds and message types', () => {
    const dispositions = section('### 4.3 PlanRevision').match(/`([^`]* \/ [^`]*)`/)!
    equalVocabulary(TASK_DISPOSITIONS, dispositions[1].split(' / '))
    const edgeRow = section('## 3.')
      .split('\n')
      .find((line) => line.startsWith('| **TaskEdge**'))!
    equalVocabulary(
      READINESS_THRESHOLDS,
      [...edgeRow.matchAll(/`([A-Z_]+)`/g)].map((match) => match[1])
    )
    equalVocabulary(
      AXIOM_MESSAGE_TYPES,
      [...section('## 5.').matchAll(/^\| `([A-Z_]+)`/gm)].map((match) => match[1])
    )
  })
})

describe('transition tables', () => {
  const missionRows: Record<string, string[]> = {
    DRAFT: ['ANALYZING'],
    ANALYZING: ['PLAN_REVIEW'],
    PLAN_REVIEW: ['PLANNED'],
    PLANNED: ['EXECUTING'],
    EXECUTING: ['REPLANNING', 'FINALIZING'],
    REPLANNING: ['EXECUTING'],
    FINALIZING: ['READY_FOR_APPROVAL'],
    READY_FOR_APPROVAL: ['COMPLETED']
  }
  const taskRows: Record<string, string[]> = {
    DEFINED: ['READY'],
    READY: ['RUNNING'],
    RUNNING: ['SUBMITTED', 'NEEDS_FIX'],
    SUBMITTED: ['VERIFYING'],
    VERIFYING: ['VERIFIED', 'NEEDS_FIX'],
    VERIFIED: ['INTEGRATION_READY'],
    INTEGRATION_READY: ['INTEGRATED', 'NEEDS_FIX'],
    NEEDS_FIX: ['READY']
  }
  it('admits exactly the Mission rows and non-terminal interruption/resume rules', () => {
    for (const from of MISSION_STATUSES) {
      for (const to of MISSION_STATUSES) {
        const expected =
          from !== to &&
          !['COMPLETED', 'FAILED', 'CANCELED'].includes(from) &&
          (['PAUSED', 'BLOCKED', 'FAILED', 'CANCELED'].includes(to) ||
            (from === 'PAUSED' && !['COMPLETED', 'FAILED', 'CANCELED'].includes(to)) ||
            (missionRows[from] ?? []).includes(to))
        expect(isLegalMissionTransition(from, to), `${from} → ${to}`).toBe(expected)
      }
      expect(isLegalMissionTransition(from, from)).toBe(false)
    }
  })
  it('admits exactly the Task rows and BLOCKED returns to non-terminal stages', () => {
    for (const from of TASK_STAGES) {
      for (const to of TASK_STAGES) {
        const expected =
          from !== to &&
          !['INTEGRATED', 'CANCELED'].includes(from) &&
          (['BLOCKED', 'CANCELED'].includes(to) ||
            (from === 'BLOCKED' && !['INTEGRATED', 'CANCELED'].includes(to)) ||
            (taskRows[from] ?? []).includes(to))
        expect(isLegalTaskStageTransition(from, to), `${from} → ${to}`).toBe(expected)
      }
      expect(isLegalTaskStageTransition(from, from)).toBe(false)
    }
  })
  it('pins terminal sets and forbids every outgoing terminal transition', () => {
    expect([...TERMINAL_MISSION_STATUSES].sort()).toEqual(['CANCELED', 'COMPLETED', 'FAILED'])
    expect([...TERMINAL_TASK_STAGES].sort()).toEqual(['CANCELED', 'INTEGRATED'])
    for (const from of TERMINAL_MISSION_STATUSES) {
      for (const to of MISSION_STATUSES) {
        expect(isLegalMissionTransition(from, to)).toBe(false)
      }
    }
    for (const from of TERMINAL_TASK_STAGES) {
      for (const to of TASK_STAGES) {
        expect(isLegalTaskStageTransition(from, to)).toBe(false)
      }
    }
  })
})
