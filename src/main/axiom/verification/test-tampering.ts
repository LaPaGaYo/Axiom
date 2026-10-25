import {
  matchesPathPattern,
  normalizePathPattern
} from '../../../shared/axiom-contract/path-patterns'

export type TestTamperingFinding = {
  path: string
  rule: 'test_file_deleted' | 'test_skip_added' | 'assertions_reduced' | 'suppression_added'
  count: number
}

const SKIPS = [
  /\b(?:describe|it|test|suite|context|bench)\.(?:skip|only|todo|skipIf|runIf|fails)\b/g,
  /\b(?:xit|xtest|xdescribe|xcontext|xsuite|fit|fdescribe|ftest)\s*\(/g,
  /@pytest\.mark\.(?:skip|skipif|xfail)\b/g,
  /\bpytest\.skip\s*\(/g,
  /@unittest\.skip/g,
  /\bt\.Skip(?:f|Now)?\s*\(/g
]
const ASSERTIONS = [
  /\b(?:expect|assert)(?:\.\w+)*\s*\(/g,
  /\bassert[A-Z]\w*\s*\(/g,
  /^\s*assert\s/gm,
  /\.should\b/g,
  /\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(/g
]
const SUPPRESSIONS = [
  /(?:eslint-disable|oxlint-disable|biome-ignore|@ts-ignore|@ts-nocheck|@ts-expect-error|#\s*noqa\b|#\s*type:\s*ignore|pylint:\s*disable|\bnolint\b|istanbul\s+ignore|c8\s+ignore|v8\s+ignore)/g
]

function occurrences(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (text.match(pattern)?.length ?? 0), 0)
}

/** D65: lexical net counts, never matched content, over a complete three-dot patch. */
export function detectTestTampering(input: {
  changes: { status: string; path: string }[]
  addedText: Map<string, string>
  removedText: Map<string, string>
  testPathPatterns: readonly string[]
  allowedPaths: readonly string[]
}): TestTamperingFinding[] {
  const { changes, addedText, removedText, testPathPatterns, allowedPaths } = input
  const isTest = (path: string) => testPathPatterns.some((entry) => matchesPathPattern(path, entry))
  const addedTests = new Set(
    changes
      .filter(({ status, path }) => status === 'A' && isTest(path))
      .map(({ path }) => addedText.get(path) ?? '')
  )
  const exactAllowed = new Set(allowedPaths.map(normalizePathPattern))
  const findings: TestTamperingFinding[] = []
  for (const { path, status } of changes) {
    const added = addedText.get(path) ?? ''
    const removed = removedText.get(path) ?? ''
    const net = (patterns: RegExp[]) =>
      occurrences(added, patterns) - occurrences(removed, patterns)
    const record = (rule: TestTamperingFinding['rule'], count: number) => {
      if (count > 0) {
        findings.push({ path, rule, count })
      }
    }
    if (isTest(path)) {
      if (status === 'D' && !exactAllowed.has(path) && !addedTests.has(removed)) {
        record('test_file_deleted', 1)
      }
      record('test_skip_added', net(SKIPS))
      if (status !== 'D') {
        record('assertions_reduced', -net(ASSERTIONS))
      }
    }
    record('suppression_added', net(SUPPRESSIONS))
  }
  // Lexical order is stable across host locales, including for punctuation in paths.
  return findings.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0
  )
}
