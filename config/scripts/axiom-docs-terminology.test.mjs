import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const documents = [
  'AGENTS.md',
  'docs/GLOSSARY.md',
  'docs/ARCHITECTURE.md',
  'docs/PROJECT_CHARTER.md',
  'docs/PROJECT_CONSTITUTION.md',
  'docs/reference/control-plane.md',
  'docs/reference/orca-mapping.md',
  'docs/plans/M3.md'
]

export function scanRetiredTerms(file, text) {
  return text
    .split(/\r?\n/)
    .flatMap((line, index) =>
      [...line.matchAll(/dcap_|--dispatch-capability|orchestrationCapability/g)].map(
        (match) => `${file}:${index + 1}: retired term ${match[0]}`
      )
    )
}

it.each(documents)('keeps retired authentication terms out of %s', (file) => {
  const findings = scanRetiredTerms(file, readFileSync(resolve(root, file), 'utf8'))
  expect(findings, findings.join('\n')).toEqual([])
})

it('reports file and line for each retired term without editing documents', () => {
  expect(
    scanRetiredTerms(
      'sample.md',
      'current text\ndcap_example\n--dispatch-capability orchestrationCapability'
    )
  ).toEqual([
    'sample.md:2: retired term dcap_',
    'sample.md:3: retired term --dispatch-capability',
    'sample.md:3: retired term orchestrationCapability'
  ])
})
