import type { z } from 'zod'

export type DecisionContext = Record<string, z.infer<ReturnType<typeof z.json>>>
export type DecisionInput<T> = { candidates: readonly T[]; context: DecisionContext }
export type DecisionRecord = { confidence: number; rationale: string; engine: 'rules' }

// Advisory only: callers own eligibility, authorization, budgets and state transitions.
export type DecisionEngine = {
  choose<T>(input: DecisionInput<T>): DecisionRecord & { choice: T }
  score<T>(input: DecisionInput<T>): DecisionRecord & { scores: { candidate: T; score: number }[] }
  classify<L extends string>(input: {
    labels: readonly L[]
    context: DecisionContext
  }): DecisionRecord & { label: L }
  rank<T>(input: DecisionInput<T>): DecisionRecord & { ranked: T[] }
}
