import { expect, it } from 'vitest'
import { isExplicitlyInScope, matchesPathPattern, normalizePathPattern } from './path-patterns'

it.each([
  ['README.md', 'README.md', true],
  ['README.md\n', 'README.md', false],
  ['src/a\nb.ts', 'src/a?b.ts', true],
  ['docs/README.md', 'README.md', false],
  ['src/storage/a/b.ts', 'src/storage/', true],
  ['src/storage/a/b.ts', 'src/storage', true],
  ['src/storage-other/a.ts', 'src/storage', false],
  ['src/services/csv-rows.test.ts', 'src/services/csv*.test.ts', true],
  ['src/services/a/csv.test.ts', 'src/services/csv*.test.ts', false],
  ['anything/.env', '.', true],
  ['package.json', '**/package.json', true],
  ['apps/x/package.json', '**/package.json', true],
  ['.github/workflows/ci.yml', '.github/workflows/**', true],
  ['.github/workflows', '.github/workflows/**', true],
  ['src/a.ts', 'src/?.ts', true],
  ['src/ab.ts', 'src/?.ts', false],
  ['src/.env', 'src/**', true],
  ['app/[id]/page.tsx', 'app/[id]/page.tsx', true],
  ['app/i/page.tsx', 'app/[id]/page.tsx', false],
  ['src/a+b(c){d}.ts', 'src/a+b(c){d}.ts', true],
  ['README.md', 'readme.md', false],
  ['a/b/c/end/file', 'a/**/end', true],
  ['a/end', 'a/**/end', true],
  ['etc/x', '/etc/x', false],
  ['a/b', 'a/../b', false]
])('matches %s against %s: %s', (file, pattern, expected) => {
  expect(matchesPathPattern(file, pattern)).toBe(expected)
})

it.each([
  ['./src//a/', 'src/a'],
  ['.\\src\\a\\', 'src/a'],
  ['././src/', 'src'],
  ['', '.'],
  ['./', '.'],
  ['.', '.'],
  ['/etc/x', null],
  ['../x', null],
  ['a/../b', null],
  ['C:\\x', null],
  ['C:relative', null],
  ['./C:/x', null],
  ['\\\\server\\file', null]
])('normalizes %s', (entry, expected) => {
  expect(normalizePathPattern(entry)).toBe(expected)
})

it.each([
  ['package.json', '**/package.json', ['.'], false],
  ['src/package.json', '**/package.json', ['src/'], false],
  ['src/package.json', '**/package.json', ['**'], false],
  ['package.json', '**/package.json', ['package.json'], true],
  ['src/package.json', '**/package.json', ['**/package.json'], true],
  ['src/storage/AGENTS.md', '**/AGENTS.md', ['src/storage/AGENTS.md'], true],
  ['src/storage/AGENTS.md', '**/AGENTS.md', ['src/storage'], false],
  ['.github/workflows/ci.yml', '.github/workflows/**', ['.github/workflows/'], true],
  ['.github/workflows/ci.yml', '.github/workflows/**', ['.github/'], false],
  ['package.json', '**/package.json', ['../package.json', '/package.json'], false],
  ['apps/x/package.json', '**/package.json', ['package.json'], false]
])('explicit scope for %s with %s and %j: %s', (file, pattern, allowed, expected) => {
  expect(isExplicitlyInScope(file, pattern, allowed)).toBe(expected)
})

it('bounds globstar recursion even for a deep unsuccessful match', () => {
  const pattern = `${Array(30).fill('**').join('/')}/missing`
  const file = Array(200).fill('segment').join('/')
  const start = performance.now()
  expect(matchesPathPattern(file, pattern)).toBe(false)
  expect(matchesPathPattern(file, Array(30).fill('**').join('/'))).toBe(true)
  expect(performance.now() - start).toBeLessThan(1000)
})
