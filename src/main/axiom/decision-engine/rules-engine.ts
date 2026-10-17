import type { DecisionContext, DecisionEngine, DecisionInput } from './decision-engine'

export type DecisionRule = {
  rationale: string
  score: (candidate: unknown, context: DecisionContext) => number | undefined
}

export class RulesEngine implements DecisionEngine {
  constructor(private readonly rules: readonly DecisionRule[] = []) {}

  score<T>({ candidates, context }: DecisionInput<T>) {
    if (!candidates.length) {
      throw Object.assign(new Error('invalid_argument'), { code: 'invalid_argument' })
    }
    const reasons = new Set<string>()
    const scores = candidates.map((candidate) => {
      for (const rule of this.rules) {
        const score = rule.score(candidate, context)
        if (score === undefined) {
          continue
        }
        if (!Number.isFinite(score)) {
          throw Object.assign(new Error('invalid_argument'), { code: 'invalid_argument' })
        }
        reasons.add(rule.rationale)
        return { candidate, score }
      }
      return { candidate, score: 0 }
    })
    return {
      scores,
      confidence: reasons.size ? 1 : 0.5,
      rationale: reasons.size
        ? this.rules
            .filter((rule) => reasons.has(rule.rationale))
            .map((rule) => rule.rationale)
            .join('; ')
        : 'default candidate order',
      engine: 'rules' as const
    }
  }

  rank<T>(input: DecisionInput<T>) {
    const { scores, ...record } = this.score(input)
    // Stable sort retains the caller's default order for ties; rules never produce candidates.
    const ranked = scores.sort((a, b) => b.score - a.score).map((row) => row.candidate)
    return { ...record, ranked }
  }

  choose<T>(input: DecisionInput<T>) {
    const { ranked, ...record } = this.rank(input)
    return { ...record, choice: ranked[0] }
  }

  classify<L extends string>({
    labels,
    context
  }: {
    labels: readonly L[]
    context: DecisionContext
  }) {
    const { choice, ...record } = this.choose({ candidates: labels, context })
    return { ...record, label: choice }
  }
}
