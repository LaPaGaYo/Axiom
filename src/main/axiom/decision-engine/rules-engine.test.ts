import { describe, expect, it } from 'vitest'
import { RulesEngine } from './rules-engine'

const candidates = ['claude', 'codex']
const context = { filtered: ['gemini'] }

describe('RulesEngine', () => {
  it('uses default input order for all four verbs', () => {
    const engine = new RulesEngine()
    expect(engine.choose({ candidates, context })).toMatchObject({
      choice: 'claude',
      confidence: 0.5,
      engine: 'rules'
    })
    expect(engine.rank({ candidates, context }).ranked).toEqual(candidates)
    expect(engine.score({ candidates, context }).scores).toEqual(
      candidates.map((candidate) => ({ candidate, score: 0 }))
    )
    expect(engine.classify({ labels: ['low', 'high'], context }).label).toBe('low')
  })
  it('uses the first matching rule per candidate and reports certain rule hits', () => {
    const engine = new RulesEngine([
      { rationale: 'preferred', score: (candidate) => (candidate === 'codex' ? 100 : undefined) },
      { rationale: 'fallback', score: () => 1 }
    ])
    expect(engine.rank({ candidates, context })).toEqual({
      ranked: ['codex', 'claude'],
      confidence: 1,
      engine: 'rules',
      rationale: 'preferred; fallback'
    })
    expect(engine.choose({ candidates, context }).choice).toBe('codex')
    expect(engine.score({ candidates, context }).scores).toEqual([
      { candidate: 'claude', score: 1 },
      { candidate: 'codex', score: 100 }
    ])
    expect(engine.classify({ labels: candidates, context }).label).toBe('codex')
  })
  it('engine cannot re-admit a filtered candidate from context', () => {
    const engine = new RulesEngine([
      {
        rationale: 'context advice',
        score: (candidate) => (candidate === 'gemini' ? 1000 : undefined)
      }
    ])
    expect(engine.rank({ candidates, context }).ranked).toEqual(['claude', 'codex'])
    expect(candidates).toContain(engine.choose({ candidates, context }).choice)
    expect(candidates).toContain(engine.classify({ labels: candidates, context }).label)
    expect(engine.score({ candidates, context }).scores.map((row) => row.candidate)).toEqual(
      candidates
    )
  })
  it('rejects every empty set and nonfinite rule scores', () => {
    const engine = new RulesEngine()
    for (const verb of ['choose', 'score', 'rank'] as const) {
      expect(() => engine[verb]({ candidates: [], context: {} })).toThrow('invalid_argument')
    }
    expect(() => engine.classify({ labels: [], context: {} })).toThrow('invalid_argument')
    expect(() =>
      new RulesEngine([{ rationale: 'bad', score: () => Number.NaN }]).rank({ candidates, context })
    ).toThrow('invalid_argument')
  })
})
