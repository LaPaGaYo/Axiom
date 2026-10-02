import { describe, expect, it } from 'vitest'
import { parseSkillShareId, skillShareIdFromArguments } from './skill-share-link'

describe('unconfigured skill share hosts', () => {
  it('accepts bare ids and rejects all URLs including local and app links', () => {
    expect(parseSkillShareId(' share_123 ')).toBe('share_123')
    for (const url of [
      'https://shares.example/skills/share/share_123',
      'http://localhost:3000/skills/share/share_123',
      'http://127.0.0.1/skills/share/share_123',
      'axiom://skills/share/share_123'
    ]) {
      expect(parseSkillShareId(url)).toBeNull()
      expect(skillShareIdFromArguments(['axiom', url])).toBeNull()
    }
  })
})
