import {
  isProviderActivated,
  recordProviderActivation,
  type ProviderActivationStore
} from '../provider-activation/provider-activation'
import type { ProviderActivationId } from '../../shared/provider-activation'
import type { WslPreflightTarget } from '../ipc/preflight-wsl-agent-detection'
import {
  execCommandInWslOrThrow,
  execLocalPreflightCommandOrThrow
} from '../ipc/preflight-command-exec'
import { quotePosixShell } from '../../shared/shell-argument-quoting'

let activationStore: ProviderActivationStore | null = null
export function setPreflightActivationStore(store: ProviderActivationStore | null): void {
  activationStore = store
}

export function mayProbeAuthentication(force: boolean, id: ProviderActivationId): boolean {
  if (force && activationStore) {
    recordProviderActivation(activationStore, id, 'integrations-recheck')
  }
  return force || isProviderActivated(activationStore?.getSettings(), id)
}

export async function probeCliAuthentication(
  provider: 'gh' | 'glab',
  wslTarget?: WslPreflightTarget,
  binary?: string
): Promise<boolean> {
  try {
    await (wslTarget
      ? execCommandInWslOrThrow(wslTarget, `${quotePosixShell(provider)} auth status`)
      : execLocalPreflightCommandOrThrow(binary ?? provider, ['auth', 'status']))
    return true
  } catch (error) {
    // Both CLIs may report successful auth on stderr despite a nonzero exit.
    const stdout =
      typeof error === 'object' &&
      error !== null &&
      'stdout' in error &&
      typeof error.stdout === 'string'
        ? error.stdout
        : ''
    const stderr =
      typeof error === 'object' &&
      error !== null &&
      'stderr' in error &&
      typeof error.stderr === 'string'
        ? error.stderr
        : ''
    const output = `${stdout}\n${stderr}`
    return (
      output.includes('Logged in') || (provider === 'gh' && output.includes('Active account: true'))
    )
  }
}
