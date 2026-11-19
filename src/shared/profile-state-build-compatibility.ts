import { hasReachedAppVersion } from './app-version'
import { isAxiomLineVersion } from './orca-baseline'

// v1.4.214 is the first stable release containing the SQLite profile cutover.
export const SQLITE_PROFILE_RELEASE_FLOOR = '1.4.214'

export function profileStateBuildCompatibilityError(
  currentVersion: string,
  targetVersion: string
): string | null {
  if (
    (!isAxiomLineVersion(currentVersion) &&
      !hasReachedAppVersion(currentVersion, SQLITE_PROFILE_RELEASE_FLOOR)) ||
    isAxiomLineVersion(targetVersion) ||
    hasReachedAppVersion(targetVersion, SQLITE_PROFILE_RELEASE_FLOOR)
  ) {
    return null
  }
  return 'This build predates SQLite profile storage. Quit Axiom and run the current CLI’s “axiom profile state rollback --latest-json --profile-id <id>” for each profile before installing it manually.'
}
