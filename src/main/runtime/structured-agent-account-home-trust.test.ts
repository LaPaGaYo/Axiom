import { expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { getDefaultSettings } from '../../shared/constants'
import type { StructuredAgentAccountHomeServices } from './structured-agent-runtime-registration-types'

const trust = vi.hoisted(() => vi.fn(async (_args: unknown) => {}))
vi.mock('../agent-workspace-trust-spawn', () => ({ applyStructuredCodexWorkspaceTrust: trust }))
import { structuredAgentRuntimeMetadata } from './structured-agent-runtime-metadata'

it('resolves the host account read only before trust, then prepares the same home', async () => {
  const root = mkdtempSync(join(tmpdir(), 'axiom-structured-trust-'))
  const home = join(root, 'codex-accounts', 'acct', 'home')
  const order: string[] = []
  const services: StructuredAgentAccountHomeServices = {
    getClaudeConfigDirectory: () => null,
    stateDirectory: join(root, 'data'),
    workspaceTrustSettings: () => getDefaultSettings(root),
    readCodexLaunchHome: () => {
      order.push('read')
      return home
    },
    prepareCodexLaunchHome: () => {
      order.push('prepare')
      return home
    }
  }
  trust.mockImplementationOnce(async (args) => {
    order.push('trust')
    expect(args).toMatchObject({
      codexAccountHomePath: home,
      workspacePath: join(root, 'repository')
    })
  })
  const metadata = structuredAgentRuntimeMetadata('codex')
  await metadata?.resolveAccountHome(
    {
      launchEnv: { HOME: root },
      location: null,
      purpose: 'launch',
      workspacePath: async () => join(root, 'repository')
    },
    services
  )
  expect(order).toEqual(['read', 'trust', 'prepare'])
})
