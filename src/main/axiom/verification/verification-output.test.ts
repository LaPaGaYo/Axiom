import { expect, it } from 'vitest'
import { verificationExcerpt, VerificationOutput } from './verification-output'
import { MAX_ARTIFACT_BYTES } from '../../../shared/axiom-contract/artifact-params'

it('keeps bounded redacted failure windows or the last forty lines', () => {
  const secret = `AKIA${'A'.repeat(16)}`
  const output = [
    ...Array(60).fill('noise'),
    `FAIL test ${secret}`,
    'AssertionError: expected 1',
    ...Array(80).fill('tail')
  ].join('\n')
  const excerpt = verificationExcerpt(output)
  expect(excerpt).toContain('FAIL test [REDACTED]')
  expect(excerpt).not.toContain(secret)
  expect(excerpt.split('\n').length).toBeLessThanOrEqual(40)
  expect(Buffer.byteLength(verificationExcerpt(`Error ${'字'.repeat(5000)}`))).toBeLessThanOrEqual(
    4096
  )
  expect(
    verificationExcerpt(Array.from({ length: 60 }, (_, i) => String(i)).join('\n')).split('\n')
  ).toEqual(Array.from({ length: 40 }, (_, i) => String(i + 20)))
})

it('caps log bytes with first MiB, newest tail, exact omitted count and redaction', () => {
  const log = new VerificationOutput()
  const content = Buffer.from(`AKIA${'B'.repeat(16)}\n${'a'.repeat(MAX_ARTIFACT_BYTES)}newest`)
  for (let i = 0; i < content.length; i += 701) {
    log.append(content.subarray(i, i + 701))
  }
  const saved = log.snapshot()
  expect(saved.truncated).toBe(true)
  expect(saved.originalBytes).toBe(content.length)
  expect(Buffer.byteLength(saved.content)).toBeLessThanOrEqual(MAX_ARTIFACT_BYTES)
  expect(saved.content.startsWith('[REDACTED]\n')).toBe(true)
  expect(saved.content).toMatch(/\[axiom: \d+ bytes omitted\]/)
  expect(saved.content.endsWith('newest')).toBe(true)
})

it('preserves UTF-8 across the head boundary and marks truncated private-key blocks', () => {
  const text = `${'a'.repeat(1024 * 1024 - 1)}字tail`
  const log = new VerificationOutput()
  log.append(Buffer.from(text))
  expect(log.snapshot().content).toBe(text)
  const key = new VerificationOutput()
  key.append(
    Buffer.from(
      `-----BEGIN PRIVATE KEY-----\n${'sensitive'.repeat(MAX_ARTIFACT_BYTES / 8)}\n-----END PRIVATE KEY-----`
    )
  )
  expect(key.snapshot().content).not.toContain('sensitive')
  expect(key.snapshot().content).toMatch(/\[axiom: \d+ bytes omitted\]/)
})

it.each([3, 9])(
  'caps %s MiB of malformed bytes expanded into UTF-8 replacement characters',
  (size) => {
    const bytes = Buffer.concat([Buffer.alloc(size * 1024 * 1024, 0xff), Buffer.from('newest')])
    const log = new VerificationOutput()
    log.append(bytes)
    const saved = log.snapshot()
    expect(saved.truncated).toBe(true)
    expect(saved.originalBytes).toBe(bytes.length)
    expect(Buffer.byteLength(saved.content)).toBeLessThanOrEqual(MAX_ARTIFACT_BYTES)
    expect(saved.content).toMatch(/\[axiom: \d+ bytes omitted\]/)
    expect(saved.content.endsWith('newest')).toBe(true)
  }
)
