import { expect, it } from 'vitest'
import { detectBuiltInSecretPatterns } from './secret-patterns'
import { detectSecretPatterns, redactContext } from '../../main/axiom/redaction/redaction'

it('uses one list of patterns to redact and to refuse', () => {
  const values = [
    {
      name: 'private_key',
      value: ['-----BEGIN ', 'RSA PRIVATE KEY-----\nbody\n-----END ', 'RSA PRIVATE KEY-----'].join(
        ''
      )
    },
    { name: 'provider_token', value: ['ghp', '_', 'x'.repeat(30)].join('') },
    { name: 'aws_access_key_id', value: ['AKIA', 'A'.repeat(16)].join('') }
  ]
  for (const { name, value } of values) {
    const text = `${value}\n${value}`
    for (let repeat = 0; repeat < 3; repeat++) {
      expect(redactContext(text)).toEqual({ content: '[REDACTED]\n[REDACTED]', redacted: true })
      expect(detectBuiltInSecretPatterns(text)).toEqual([name])
      expect(detectSecretPatterns(text)).toEqual([name])
    }
  }
  const text = 'No API keys, tokens or passwords appear in logs'
  expect(redactContext(text)).toEqual({ content: text, redacted: false })
  expect(detectBuiltInSecretPatterns(text)).toEqual([])
  expect(detectSecretPatterns(text, ['passwords'])).toEqual(['policy:0'])
  const combined = values.map(({ value }) => value).join('\n')
  expect(detectBuiltInSecretPatterns(combined)).toEqual(values.map(({ name }) => name))
  expect(detectSecretPatterns(combined, ['body'])).toEqual([
    ...values.map(({ name }) => name),
    'policy:0'
  ])
})
