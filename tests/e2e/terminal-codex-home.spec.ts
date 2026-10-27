import { seedCodexTestAccount } from './helpers/codex-test-account'
import { test, expect } from './helpers/orca-app'
import {
  execInTerminal,
  getTerminalContent,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

type CodexHomeProbe = {
  codexHome: string | null
  orcaCodexHome: string | null
}

function readCodexHomeProbe(pageContent: string, marker: string): CodexHomeProbe | null {
  const match = new RegExp(`${marker}:(\\{[^\\r\\n]+\\})`).exec(pageContent)
  if (!match) {
    return null
  }
  return JSON.parse(match[1] ?? 'null') as CodexHomeProbe | null
}

test.describe('Terminal Codex runtime home', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
  })

  test('terminal process receives the selected account Codex home', async ({
    electronApp,
    orcaPage
  }) => {
    const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const { homePath: managedHomePath, settings } = seedCodexTestAccount(userData, {
      accountId: 'e2e-terminal-home',
      persistSettings: false
    })
    await orcaPage.evaluate(async (settings) => {
      const state = window.__store!.getState()
      await state.updateSettings(settings)
      const tab = state.createTab(state.activeWorktreeId!)
      state.setActiveTab(tab.id)
      state.setActiveTabType('terminal', window.__store?.getState().activeWorktreeId ?? null)
    }, settings)
    await waitForActiveTerminalManager(orcaPage)
    const ptyId = await waitForActivePanePtyId(orcaPage)
    const marker = `__ORCA_CODEX_HOME_E2E_${Date.now()}__`
    const command = [
      'node -e',
      `"console.log('${marker}:' + JSON.stringify({codexHome: process.env.CODEX_HOME || null, orcaCodexHome: process.env.ORCA_CODEX_HOME || null}))"`
    ].join(' ')

    await execInTerminal(orcaPage, ptyId, command)

    let probe: CodexHomeProbe | null = null
    await expect
      .poll(
        async () => {
          probe = readCodexHomeProbe(await getTerminalContent(orcaPage), marker)
          return probe
        },
        { timeout: 15_000, message: 'Terminal did not expose the selected Codex account home' }
      )
      .toEqual({ codexHome: managedHomePath, orcaCodexHome: managedHomePath })
  })
})
