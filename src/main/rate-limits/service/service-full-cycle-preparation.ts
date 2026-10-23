import { fetchClaudeRateLimits } from '../claude-fetcher'
import { fetchCodexRateLimits } from '../codex-fetcher'
import { fetchGeminiRateLimits } from '../gemini-usage-fetcher'
import { fetchGrokRateLimits } from '../grok-fetcher'
import { readGrokAuthSession } from '../grok-auth'
import { fetchCursorRateLimits } from '../cursor-fetcher'
import { readCursorAuthSession } from '../cursor-auth'
import { fetchZcodeRateLimits } from '../zcode-usage-fetcher'
import { fetchAntigravityRateLimits } from '../antigravity-usage-fetcher'
import { antigravityUsageDisabledSnapshot } from '../antigravity-usage-snapshot'
import { ZCODE_PLAN_SITE_BASE_URLS } from '../../../shared/zcode-plan-sites'
import { fetchMiniMaxRateLimits } from '../minimax/minimax-fetcher'
import { createHash } from 'node:crypto'
import { fetchOpenCodeGoUsage } from '../opencode-go-usage-source-selection'
import { RateLimitServiceFetchPolicy } from './service-fetch-policy'
import type { ProviderRateLimits } from './service-types'
import type { FetchAllCyclePrepared } from './service-full-cycle-types'
export type { FetchAllCyclePrepared } from './service-full-cycle-types'

export abstract class RateLimitServiceFullCyclePreparation extends RateLimitServiceFetchPolicy {
  protected async prepareFetchAllCycle(
    signal: AbortSignal,
    options?: { force?: boolean }
  ): Promise<FetchAllCyclePrepared | null> {
    if (signal.aborted) {
      return null
    }
    const mayFetch = (provider: ProviderRateLimits['provider']): boolean =>
      options?.force === true || this.providerActivationResolver(provider)
    const claudeTarget = this.claudeFetchTarget
    // Why: capture before the resolver await so an account switch during it invalidates both the snapshot and the state apply.
    const claudeGeneration = this.claudeFetchGeneration
    const claudeAuthPreparation = mayFetch('claude')
      ? await this.claudeAuthPreparationResolver?.(claudeTarget)
      : undefined
    if (signal.aborted) {
      return null
    }
    if (mayFetch('claude')) {
      this.rememberClaudeAuthSnapshot(claudeAuthPreparation, claudeGeneration, claudeTarget)
    }
    const claudeProvenance = claudeAuthPreparation?.provenance ?? 'system'
    const codexTarget = this.codexFetchTarget
    // Why: capture before the resolver await; a reset during it bumps the generation and this cycle's result is stale.
    const codexGeneration = this.codexFetchGeneration
    const previousState = this.state
    // Why: a skipped Codex poll must not stop the other providers' cycle, so gate
    // only the Codex slot instead of returning early (#STA-4422).
    const codexHome = mayFetch('codex')
      ? await this.resolveCodexHome(codexTarget)
      : { skip: true, homePath: null }
    const codexFetchGated = codexHome.skip
    const codexHomePath = codexHome.homePath
    const codexStateBeforeFetch =
      previousState.codex?.status === 'fetching' ? null : previousState.codex
    const codexProvenance = codexFetchGated
      ? null
      : this.getCodexProvenance(codexTarget, codexHomePath)
    const openCodeGoConfig = this.resolveOpenCodeGoConfig()
    const cookie = openCodeGoConfig.sessionCookie
    const workspaceIdOverride = openCodeGoConfig.workspaceIdOverride
    const openCodeGoApiKey = openCodeGoConfig.apiKey
    const openCodeGoApiKeyError = openCodeGoConfig.apiKeyError
    const openCodeGoApiKeyReadSkipped = openCodeGoConfig.apiKeyReadSkipped
    const miniMaxConfigResult = this.resolveMiniMaxConfig()
    const miniMaxCookie = miniMaxConfigResult.config.sessionCookie
    const miniMaxGroupId = miniMaxConfigResult.config.groupId
    const miniMaxModels = miniMaxConfigResult.config.models
    const miniMaxEndpoint = miniMaxConfigResult.config.endpoint
    const miniMaxApiKey = miniMaxConfigResult.config.apiKey
    const geminiCliOAuthEnabled = this.geminiCliOAuthEnabledResolver?.() ?? false
    // Why: getState() is hot (renderer pushes + mobile snapshots); keep Grok's sync auth-file probe on fetch cycles instead.
    const grokAuthReadResult = readGrokAuthSession()
    this.grokAuthConfigured = grokAuthReadResult.status === 'ok'

    // Discard stale data on config change — it belongs to a different session/workspace.
    // Digest, not the key: this string only has to change when the account does.
    const apiKeyFingerprint = openCodeGoApiKey
      ? createHash('sha256').update(openCodeGoApiKey).digest('hex')
      : ''
    const currentConfigHash = `${cookie}|${workspaceIdOverride}|${apiKeyFingerprint}|${openCodeGoApiKeyError ?? ''}`
    const opencodeConfigChanged = currentConfigHash !== this.lastOpencodeConfigHash
    if (opencodeConfigChanged) {
      this.lastOpencodeConfigHash = currentConfigHash
      this.opencodeFetchGeneration += 1
    }
    const opencodeGeneration = this.opencodeFetchGeneration

    const currentMiniMaxConfigHash = `${miniMaxCookie}|${miniMaxGroupId}|${miniMaxModels}|${miniMaxEndpoint}|${miniMaxApiKey}|${miniMaxConfigResult.error ?? ''}`
    const miniMaxConfigChanged = currentMiniMaxConfigHash !== this.lastMiniMaxConfigHash
    if (miniMaxConfigChanged) {
      this.lastMiniMaxConfigHash = currentMiniMaxConfigHash
      this.minimaxFetchGeneration += 1
    }
    const miniMaxGeneration = this.minimaxFetchGeneration

    const antigravityUsageEnabled = this.antigravityUsageEnabledResolver?.() ?? true

    const zcodePlanConfigResult = this.resolveZcodePlanConfig()
    const zcodePlanApiKey = zcodePlanConfigResult.config.apiKey
    // Why digest, not the key: this string only has to change when the credential does.
    const currentZcodeConfigHash = zcodePlanApiKey
      ? `${zcodePlanConfigResult.config.site}|${createHash('sha256').update(zcodePlanApiKey).digest('hex')}`
      : (zcodePlanConfigResult.error ?? '')
    const zcodeConfigChanged = currentZcodeConfigHash !== this.lastZcodeConfigHash
    if (zcodeConfigChanged) {
      this.lastZcodeConfigHash = currentZcodeConfigHash
      this.zcodeFetchGeneration += 1
    }
    const zcodeGeneration = this.zcodeFetchGeneration
    const zcodePlanCredential = zcodePlanApiKey
      ? {
          apiKey: zcodePlanApiKey,
          baseUrl: ZCODE_PLAN_SITE_BASE_URLS[zcodePlanConfigResult.config.site]
        }
      : null

    // Mark all providers fetching while keeping previous data visible (Codex is cleared separately on account change).
    const fetchingState = {
      ...previousState,
      claude: this.withFetchingStatus(previousState.claude, 'claude'),
      // Why: a gated Codex cycle makes no attempt; a "fetching" chip would never settle.
      codex: codexFetchGated
        ? codexStateBeforeFetch
        : this.withFetchingStatus(previousState.codex, 'codex'),
      gemini: this.withFetchingStatus(previousState.gemini, 'gemini'),
      opencodeGo: opencodeConfigChanged
        ? this.withFetchingStatus(null, 'opencode-go')
        : this.withFetchingStatus(previousState.opencodeGo, 'opencode-go'),
      kimi: this.withFetchingStatus(previousState.kimi, 'kimi'),
      antigravity: antigravityUsageEnabled
        ? this.withFetchingStatus(previousState.antigravity, 'antigravity')
        : (previousState.antigravity ?? antigravityUsageDisabledSnapshot()),
      minimax: miniMaxConfigChanged
        ? this.withFetchingStatus(null, 'minimax')
        : this.withFetchingStatus(previousState.minimax, 'minimax'),
      grok: this.withFetchingStatus(previousState.grok, 'grok'),
      cursor: this.withFetchingStatus(previousState.cursor, 'cursor'),
      zcode: zcodeConfigChanged
        ? this.withFetchingStatus(null, 'zcode')
        : this.withFetchingStatus(previousState.zcode, 'zcode')
    }

    this.updateState({
      claude: mayFetch('claude') ? fetchingState.claude : previousState.claude,
      codex: mayFetch('codex') ? fetchingState.codex : previousState.codex,
      gemini: mayFetch('gemini') ? fetchingState.gemini : previousState.gemini,
      opencodeGo: mayFetch('opencode-go') ? fetchingState.opencodeGo : previousState.opencodeGo,
      kimi: mayFetch('kimi') ? fetchingState.kimi : previousState.kimi,
      minimax: mayFetch('minimax') ? fetchingState.minimax : previousState.minimax,
      grok: mayFetch('grok') ? fetchingState.grok : previousState.grok,
      cursor: mayFetch('cursor') ? fetchingState.cursor : previousState.cursor,
      zcode: mayFetch('zcode') ? fetchingState.zcode : previousState.zcode,
      antigravity: mayFetch('antigravity') ? fetchingState.antigravity : previousState.antigravity
    })

    // Why: the Cursor probe reads the macOS Keychain, so it is awaited inside the
    // provider's own promise instead of blocking the rest of the cycle on it.
    const cursorResultPromise = this.fetchActivatedProvider('cursor', options?.force, () =>
      readCursorAuthSession().then((authReadResult) => {
        this.cursorAuthConfigured = authReadResult.status === 'ok'
        return fetchCursorRateLimits({ signal, authReadResult })
      })
    ).then(
      (value) => ({ status: 'fulfilled', value }) as const,
      (reason) => ({ status: 'rejected', reason }) as const
    )

    const zcodeResultPromise = this.fetchActivatedProvider('zcode', options?.force, () =>
      zcodePlanConfigResult.error
        ? Promise.resolve(this.getZcodePlanCredentialError(zcodePlanConfigResult.error))
        : fetchZcodeRateLimits({ signal, planCredential: zcodePlanCredential })
    ).then(
      (value) => ({ status: 'fulfilled', value }) as const,
      (reason) => ({ status: 'rejected', reason }) as const
    )

    // Hidden meters avoid the CLI spawn; the separate promise keeps other providers responsive.
    const antigravityResultPromise = this.fetchActivatedProvider(
      'antigravity',
      options?.force,
      () =>
        antigravityUsageEnabled
          ? fetchAntigravityRateLimits({ signal })
          : Promise.resolve(previousState.antigravity ?? antigravityUsageDisabledSnapshot())
    ).then(
      (value) => ({ status: 'fulfilled', value }) as const,
      (reason) => ({ status: 'rejected', reason }) as const
    )

    const missingWslCodexHome =
      codexFetchGated || codexHomePath ? null : this.getMissingWslCodexHomeResult(codexTarget)
    const grokResultPromise = this.fetchActivatedProvider('grok', options?.force, () =>
      fetchGrokRateLimits({
        signal,
        authReadResult: grokAuthReadResult
      })
    ).then(
      (value) => ({ status: 'fulfilled', value }) as const,
      (reason) => ({ status: 'rejected', reason }) as const
    )

    // Why: skip automated Claude fetches while a Retry-After window is open or a live session feed is fresher than the OAuth poll would be.
    const claudeFetchGated =
      !mayFetch('claude') ||
      (!options?.force && this.shouldSkipAutomatedClaudeFetch(previousState.claude))

    const [claudeResult, codexResult, geminiResult, opencodeGoResult, kimiResult, miniMaxResult] =
      await Promise.allSettled([
        claudeFetchGated
          ? Promise.resolve(previousState.claude as ProviderRateLimits)
          : fetchClaudeRateLimits({
              authPreparation: claudeAuthPreparation,
              allowPtyFallback: this.shouldAllowClaudePtyFallback(claudeAuthPreparation),
              allowUsagePanelSupplement: this.shouldAllowClaudeUsagePanelSupplement(),
              networkProxySettings: this.networkProxySettingsResolver?.(),
              signal
            }),
        codexFetchGated
          ? Promise.resolve(previousState.codex as ProviderRateLimits)
          : (missingWslCodexHome ??
            fetchCodexRateLimits({
              codexHomePath,
              networkProxySettings: this.networkProxySettingsResolver?.(),
              signal
            })),
        this.fetchActivatedProvider('gemini', options?.force, () =>
          fetchGeminiRateLimits(geminiCliOAuthEnabled)
        ),
        this.fetchActivatedProvider('opencode-go', options?.force, () =>
          fetchOpenCodeGoUsage({
            settingsApiKey: openCodeGoApiKey,
            // Why here: the key can also come from the environment or OpenCode's
            // own store, so presence is only known once the fetch resolves it.
            onApiKeyResolved: (resolution) => {
              if (opencodeGeneration !== this.opencodeFetchGeneration) {
                return
              }
              this.openCodeGoApiKeyConfigured =
                resolution.status === 'found' ||
                openCodeGoApiKeyError !== null ||
                openCodeGoApiKeyReadSkipped
            },
            cookie,
            workspaceIdOverride: workspaceIdOverride || undefined,
            networkProxySettings: this.networkProxySettingsResolver?.(),
            signal
          })
        ),
        this.fetchActivatedProvider('kimi', options?.force, () => this.fetchKimiWithResolvedHome()),
        this.fetchActivatedProvider('minimax', options?.force, () =>
          miniMaxConfigResult.error
            ? Promise.resolve(this.getMiniMaxCredentialError(miniMaxConfigResult.error))
            : fetchMiniMaxRateLimits({
                cookie: miniMaxCookie,
                groupId: miniMaxGroupId,
                models: miniMaxModels,
                endpointMode: miniMaxEndpoint,
                apiKey: miniMaxApiKey
              })
        )
      ])

    if (signal.aborted) {
      return null
    }
    // Why: the decrypt error only replaces a result with no usage and no diagnosis of its own; a real cookie error stays visible.
    if (
      openCodeGoApiKeyError &&
      opencodeGoResult.status === 'fulfilled' &&
      opencodeGoResult.value.status === 'unavailable'
    ) {
      opencodeGoResult.value = {
        ...opencodeGoResult.value,
        error: openCodeGoApiKeyError,
        status: 'error'
      }
    }
    return {
      mayFetch,
      claudeTarget,
      claudeGeneration,
      claudeAuthPreparation,
      claudeProvenance,
      codexTarget,
      previousState,
      codexFetchGated,
      codexStateBeforeFetch,
      codexProvenance,
      codexGeneration,
      opencodeConfigChanged,
      opencodeGeneration,
      miniMaxConfigChanged,
      miniMaxGeneration,
      zcodeConfigChanged,
      zcodeGeneration,
      claudeFetchGated,
      results: [
        claudeResult,
        codexResult,
        geminiResult,
        opencodeGoResult,
        kimiResult,
        miniMaxResult
      ],
      grokResultPromise,
      cursorResultPromise,
      zcodeResultPromise,
      antigravityResultPromise
    }
  }
}
