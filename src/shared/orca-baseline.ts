import { compareAppVersions, isValidAppVersion } from './app-version'

// D90 item 2: only a full upstream sync updates this build's kernel baseline.
export const ORCA_BASELINE = {
  version: '1.4.214',
  commit: '41661e33128c3a308a570aa0ed96ce24910a98c4'
} as const

export function isAxiomLineVersion(value: string): boolean {
  if (!isValidAppVersion(value)) {
    return false
  }
  const [major, minor] = value.trim().replace(/^v/i, '').split('.')
  return Number(major) === 0 && Number(minor) >= 1
}

export function upstreamLineVersion(value: string): string {
  return isAxiomLineVersion(value) ? ORCA_BASELINE.version : value
}

// Orders one pair for a rule, not a list: 0.1.0 and 0.2.0 both meet 1.4.214 as equals.
export function compareAppVersionsAcrossLines(left: string, right: string): number {
  if (isAxiomLineVersion(left) === isAxiomLineVersion(right)) {
    return compareAppVersions(left, right)
  }
  return compareAppVersions(upstreamLineVersion(left), upstreamLineVersion(right))
}
