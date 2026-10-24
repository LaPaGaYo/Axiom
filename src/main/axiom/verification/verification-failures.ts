import { stripVTControlCharacters } from 'node:util'

// ponytail: only Vitest FAIL headers, Jest bullets and fixture reporter lines are understood in V1.
export function extractFailureNames(output: string): string[] {
  const failures = new Set<string>()
  let jestFile: string | undefined
  for (const line of stripVTControlCharacters(output).split(/\r?\n/)) {
    const header = line.match(/^\s*FAIL\s+(.+?)(?:\s+>\s+(.+))?$/)
    const bullet = line.match(/^\s*●\s+(.+)$/)
    let failure: string | undefined
    if (header) {
      // Vitest may insert a project column before the file; file is the last column.
      const file = header[1]
        .replace(/\s+\([\d.]+\s*m?s\)$/, '')
        .trim()
        .split(/\s+/)
        .at(-1)
      if (file && header[2]) {
        failure = `${file} > ${header[2]}`
      } else {
        jestFile = file
      }
    } else if (bullet) {
      failure = `${jestFile ? `${jestFile} > ` : ''}${bullet[1].replace(/\s*›\s*/g, ' > ')}`
    } else {
      // The first ': ' after ' > ' ends the name, even when it occurs inside the test name.
      failure = line.match(
        /^\s*(\S+\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts) > .+?): /
      )?.[1]
    }
    if (failure) {
      failures.add(failure.trim().slice(0, 300))
    }
    if (failures.size === 20) {
      break
    }
  }
  return [...failures]
}
