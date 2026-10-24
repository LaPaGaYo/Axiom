import { expect, it } from 'vitest'
import { detectSecretPatterns, redactContext } from './redaction'

const privateKey = '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----'
const provider = `gh` + `p_${'x'.repeat(36)}`
const aws = `AKIA${'A'.repeat(16)}`

it.each([
  [privateKey, 'private_key'],
  [provider, 'provider_token'],
  [aws, 'aws_access_key_id']
])('detects the built-in pattern by name without returning content (%#)', (text, name) => {
  expect(detectSecretPatterns(text)).toEqual([name])
  expect(redactContext(`before ${text} after`)).toEqual({
    content: 'before [REDACTED] after',
    redacted: true
  })
})

it('is stateless, deduplicates names and retains built-in then policy order', () => {
  const text = `${aws}\n${provider}\n${privateKey}\n${provider}\ncustom_value`
  for (let i = 0; i < 3; i++) {
    expect(detectSecretPatterns(text, ['custom_.*', '^absent$', 'custom_value'])).toEqual([
      'private_key',
      'provider_token',
      'aws_access_key_id',
      'policy:0',
      'policy:2'
    ])
    expect(detectSecretPatterns('safe')).toEqual([])
    expect(redactContext(text).content).not.toContain(provider)
  }
  expect(detectSecretPatterns('CUSTOM_VALUE', ['custom_value'])).toEqual([])
})
