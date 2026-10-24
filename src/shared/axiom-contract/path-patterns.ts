/** Shared repository-relative semantics; deliberately not a shell glob dialect. */
export function normalizePathPattern(entry: string): string | null {
  const normalized = entry
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^(\.\/)+/, '')
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    return null
  }
  return normalized.replace(/\/$/, '') || '.'
}

export function matchesPathPattern(path: string, pattern: string): boolean {
  const normalized = normalizePathPattern(pattern)
  if (normalized === null) {
    return false
  }
  if (normalized === '.') {
    return true
  }
  const segments = normalized
    .split('/')
    .filter((part, i, all) => part !== '**' || all[i - 1] !== '**')
  const matchers = segments.map(
    (part) =>
      new RegExp(
        `^${Array.from(part)
          .map((char) => {
            if (char === '*') {
              return '[\\s\\S]*'
            }
            if (char === '?') {
              return '[\\s\\S]'
            }
            return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          })
          .join('')}$`
      )
  )
  const paths = path.split('/')
  const memo = new Map<string, boolean>()
  function match(patternIndex: number, pathIndex: number): boolean {
    if (patternIndex === segments.length) {
      return true // An entry also covers every descendant of the matched prefix.
    }
    const key = `${patternIndex}:${pathIndex}`
    const cached = memo.get(key)
    if (cached !== undefined) {
      return cached
    }
    const result =
      segments[patternIndex] === '**'
        ? match(patternIndex + 1, pathIndex) ||
          (pathIndex < paths.length && match(patternIndex, pathIndex + 1))
        : pathIndex < paths.length &&
          matchers[patternIndex].test(paths[pathIndex]) &&
          match(patternIndex + 1, pathIndex + 1)
    memo.set(key, result)
    return result
  }
  return match(0, 0)
}

export function isExplicitlyInScope(
  path: string,
  dangerousPattern: string,
  allowedPaths: readonly string[]
): boolean {
  return allowedPaths.some((entry) => {
    const normalized = normalizePathPattern(entry)
    return (
      normalized !== null &&
      matchesPathPattern(path, normalized) &&
      matchesPathPattern(normalized, dangerousPattern)
    )
  })
}
