/** Shared repository-relative semantics; deliberately not a shell glob dialect. */
export function normalizePathPattern(entry: string): string | null {
  if (entry === '') {
    return null
  }
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

function segmentMatches(pattern: readonly string[], value: readonly string[]): boolean {
  let patternIndex = 0
  let valueIndex = 0
  let starIndex = -1
  let starMatchIndex = 0
  // Retry only the latest star; never explore combinations of earlier star matches.
  while (valueIndex < value.length) {
    const token = pattern[patternIndex]
    if (token === '*') {
      starIndex = patternIndex++
      starMatchIndex = valueIndex
    } else if (token === '?' || token === value[valueIndex]) {
      patternIndex++
      valueIndex++
    } else if (starIndex !== -1) {
      patternIndex = starIndex + 1
      valueIndex = ++starMatchIndex
    } else {
      return false
    }
  }
  while (pattern[patternIndex] === '*') {
    patternIndex++
  }
  return patternIndex === pattern.length
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
  const patterns = segments.map((part) => Array.from(part))
  const paths = path.split('/').map((part) => Array.from(part))
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
          segmentMatches(patterns[patternIndex], paths[pathIndex]) &&
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
