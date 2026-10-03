import type { PluginInstallSource } from '../../shared/plugins/plugin-install-lockfile'
import {
  isOfficialOrganizationGitSource,
  isReservedPluginIdentity
} from '../../shared/plugins/plugin-marketplace'

export function pluginInstallTrustError(
  pluginKey: string,
  source: PluginInstallSource,
  bundledPluginKeys: readonly string[] = []
): string | null {
  if (source.kind === 'bundled') {
    // Only the host's release index can authorize a bundled identity; publishers grant no trust.
    return source.bundleId === pluginKey && bundledPluginKeys.includes(pluginKey)
      ? null
      : 'bundled plugins must use an identity listed in the bundled resource index'
  }
  if (!isReservedPluginIdentity(pluginKey)) {
    return null
  }
  if (source.kind === 'local-path') {
    return `reserved plugin identity ${pluginKey} cannot be installed from a local path`
  }
  const url = source.kind === 'git' ? source.url : source.plugin.url
  return isOfficialOrganizationGitSource(url)
    ? null
    : `reserved plugin identity ${pluginKey} must resolve to the configured official organization`
}
