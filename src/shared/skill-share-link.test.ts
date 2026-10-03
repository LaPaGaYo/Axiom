import { describe, expect, it } from 'vitest'
import { parseSkillShareId, skillShareIdFromArguments } from './skill-share-link'

describe('unconfigured skill share hosts', () => {
  it('accepts bare ids and Axiom deep links while rejecting HTTPS share links', () => {
    const upstreamHost = ['app', 'orca', 'dev'].join('.')
    expect(parseSkillShareId('x')).toBe('x')
    expect(parseSkillShareId('axiom://skills/share/x')).toBe('x')
    expect(parseSkillShareId(`https://${upstreamHost}/skills/share/x`)).toBeNull()
    expect(parseSkillShareId('https://attacker.test/skills/share/x')).toBeNull()
  })

  it('accepts trimmed bare ids and rejects web URLs when hosts are unconfigured', () => {
    expect(parseSkillShareId(' share_123 ')).toBe('share_123')
    for (const url of [
      'https://shares.example/skills/share/share_123',
      'http://localhost:3000/skills/share/share_123',
      'http://127.0.0.1/skills/share/share_123'
    ]) {
      expect(parseSkillShareId(url)).toBeNull()
      expect(skillShareIdFromArguments(['axiom', url])).toBeNull()
    }
  })
})
