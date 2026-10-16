import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflow = parse(
  readFileSync(join(projectDir, '.github/workflows/skill-update-roundtrip.yml'), 'utf8')
)

const expectedPaths = [
  'skills/**',
  'resources/skills/**',
  'config/scripts/verify-skill-update-roundtrip.mjs',
  'config/scripts/skill-update-roundtrip-workflow.test.mjs',
  'src/main/skills/skill-freshness-eligibility.ts',
  'src/shared/skill-freshness.ts',
  '.github/workflows/skill-update-roundtrip.yml'
]

describe('skill-update-roundtrip workflow triggers', () => {
  it('keeps the pull_request path filter and merge_group without push runs', () => {
    expect(workflow.on.pull_request.paths).toEqual(expectedPaths)
    expect(workflow.on.push).toBeUndefined()
    expect(workflow.on.merge_group).toBeNull()
  })

  it('does not claim a path filter on merge_group that GitHub would ignore', () => {
    expect(workflow.on.merge_group).toBeDefined()
    expect(workflow.on.merge_group?.paths).toBeUndefined()
  })
})
