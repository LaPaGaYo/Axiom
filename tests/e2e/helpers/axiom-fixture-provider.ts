import { chmodSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { DEFAULT_ROUTING_POLICY } from '../../../src/shared/axiom-contract/mission-objects'
import { AXIOM_TEST_PROVIDER_SOURCE } from './axiom-test-provider'
import {
  AXIOM_TEST_CLAUDE_MODEL,
  AXIOM_TEST_CLAUDE_PROVIDER_SOURCE
} from './axiom-test-claude-provider'
import {
  buildFakeAgentCommandOverride,
  FAKE_AGENT_WINDOWS_SHELL
} from './fake-agent-command-override'

export type AxiomFixtureProvider = 'codex' | 'claude'

export function createAxiomFixtureProvider(directory: string, provider: AxiomFixtureProvider) {
  const source =
    provider === 'claude' ? AXIOM_TEST_CLAUDE_PROVIDER_SOURCE : AXIOM_TEST_PROVIDER_SOURCE
  const executable = path.join(
    directory,
    process.platform === 'win32' ? `${provider}.cmd` : provider
  )
  if (process.platform === 'win32') {
    writeFileSync(path.join(directory, `fake-${provider}.js`), source)
    writeFileSync(executable, `@echo off\r\nnode "%~dp0\\fake-${provider}.js" %*\r\n`)
  } else {
    writeFileSync(executable, `#!/usr/bin/env node\n${source}`)
    chmodSync(executable, 0o755)
  }
  return executable
}

export function axiomFixtureRouting(provider: AxiomFixtureProvider) {
  return {
    ...DEFAULT_ROUTING_POLICY,
    preferredProviders: [provider],
    disallowedProviders: ['codex', 'claude', 'opencode', 'antigravity'].filter(
      (id) => id !== provider
    ),
    crossProvider: false,
    ...(provider === 'claude'
      ? {
          roles: { worker: { provider, model: AXIOM_TEST_CLAUDE_MODEL, effort: 'medium' as const } }
        }
      : {})
  }
}

export async function configureAxiomFixtureProvider(
  page: Page,
  executable: string,
  provider: AxiomFixtureProvider
) {
  await page.evaluate(
    async ({ command, shell, provider }) => {
      await window.__store?.getState().updateSettings({
        agentCmdOverrides: { [provider]: command },
        terminalWindowsShell: shell
      })
    },
    {
      command: buildFakeAgentCommandOverride(executable),
      shell: FAKE_AGENT_WINDOWS_SHELL,
      provider
    }
  )
}
