import { describe, expect, it } from 'vitest'
import { canonicalContextManifest, ContextManifestSchema } from './context-package'

const manifest = {
  version: 1 as const,
  missionId: 'm',
  taskId: 't',
  planRevisionId: 'p',
  tokenBudget: 10,
  mandatory: [{ section: 'Task spec', source: 'task:t', sha256: 'a'.repeat(64), tokens: 20 }],
  ranked: [],
  omitted: [],
  budgetExceededByMandatory: true as const
}
describe('canonical context manifest', () => {
  it('fixes key order without whitespace while preserving section order', () => {
    const reordered = ContextManifestSchema.parse(
      Object.fromEntries(Object.entries(manifest).toReversed())
    )
    expect(canonicalContextManifest(reordered)).toBe(canonicalContextManifest(manifest))
    expect(canonicalContextManifest(manifest)).toBe(
      `{"version":1,"missionId":"m","taskId":"t","planRevisionId":"p","tokenBudget":10,"mandatory":[{"section":"Task spec","source":"task:t","sha256":"${'a'.repeat(
        64
      )}","tokens":20}],"ranked":[],"omitted":[],"budgetExceededByMandatory":true}`
    )
    expect(ContextManifestSchema.safeParse({ ...manifest, tokenBudget: -1 }).success).toBe(false)
    expect(
      ContextManifestSchema.safeParse({
        ...manifest,
        omitted: [{ artifactId: 'a', reason: 'random' }]
      }).success
    ).toBe(false)
  })
})
