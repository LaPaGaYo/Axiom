// Renderer-controlled input must still pass the main-owned event and cohort boundary.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>()
const { handleMock, trackMock, getCohortAtEmitMock, getOnboardingCohortAtEmitMock } = vi.hoisted(
  () => ({
    handleMock:
      vi.fn<(channel: string, handler: (_event: unknown, ...args: unknown[]) => unknown) => void>(),
    trackMock: vi.fn(),
    getCohortAtEmitMock: vi.fn(),
    getOnboardingCohortAtEmitMock: vi.fn()
  })
)

vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }))
vi.mock('../telemetry/client', () => ({
  track: trackMock
}))
vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: getCohortAtEmitMock
}))
vi.mock('../telemetry/onboarding-cohort-classifier', () => ({
  getOnboardingCohortAtEmit: getOnboardingCohortAtEmitMock
}))

import { registerTelemetryHandlers } from './telemetry'

function registerHandlers(): void {
  registerTelemetryHandlers()
  handlers.clear()
  for (const [channel, handler] of handleMock.mock.calls) {
    handlers.set(channel, handler)
  }
}

describe('telemetry IPC handlers', () => {
  beforeEach(() => {
    handleMock.mockReset()
    trackMock.mockReset()
    getCohortAtEmitMock.mockReset()
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 0 })
    getOnboardingCohortAtEmitMock.mockReset()
    getOnboardingCohortAtEmitMock.mockReturnValue({ cohort: undefined })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers only the track channel', () => {
    registerHandlers()
    expect([...handlers.keys()]).toEqual(['telemetry:track'])
  })

  // ── telemetry:track ──────────────────────────────────────────────────

  it('forwards a well-typed track call to track() and injects cohort for COHORT_EXTENDED events', () => {
    registerHandlers()
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'app_opened', {})
    expect(trackMock).toHaveBeenCalledTimes(1)
    expect(trackMock).toHaveBeenCalledWith('app_opened', { nth_repo_added: 2 })
  })

  // Schemas are `.strict()`, so injecting `nth_repo_added` on a non-cohort event would drop the whole event at the validator.
  it('does NOT inject cohort on events outside COHORT_EXTENDED', () => {
    registerHandlers()
    const handler = handlers.get('telemetry:track')!
    handler({}, 'settings_changed', { setting_key: 'editorAutoSave', value_kind: 'bool' })
    expect(trackMock).toHaveBeenCalledTimes(1)
    expect(trackMock).toHaveBeenCalledWith('settings_changed', {
      setting_key: 'editorAutoSave',
      value_kind: 'bool'
    })
    expect(getCohortAtEmitMock).not.toHaveBeenCalled()
  })

  // Renderer-only Setup-step events depend on the handler injecting cohort so call sites stay synchronous.
  it('injects cohort for add_repo_setup_step_action (renderer-only event)', () => {
    registerHandlers()
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 1 })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'add_repo_setup_step_action', { action: 'skip' })
    expect(trackMock).toHaveBeenCalledWith('add_repo_setup_step_action', {
      action: 'skip',
      nth_repo_added: 1
    })
  })

  it('drops main-owned events from renderer telemetry IPC', () => {
    registerHandlers()
    const handler = handlers.get('telemetry:track')!
    handler({}, 'app_starred_orca', { source: 'settings' })
    handler({}, 'star_nag_outcome', {
      outcome: 'shown',
      source: 'threshold',
      mode: 'gh',
      threshold: 35,
      agents_since_baseline: 35,
      agents_since_baseline_bucket: '35-69'
    })
    handler({}, 'feature_interaction_usage_bucket_reached', {
      feature_id: 'tasks',
      feature_category: 'task_management',
      count_bucket: 'count_1',
      bucket_source: 'crossed_now'
    })
    handler({}, 'daemon_audit_eligibility', {})
    expect(trackMock).not.toHaveBeenCalled()
    expect(getCohortAtEmitMock).not.toHaveBeenCalled()
  })

  it('injects cohort for setup script prompt events', () => {
    registerHandlers()
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 3 })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'setup_script_prompt_shown', {
      mode: 'import_available',
      provider: 'codex',
      file_count_bucket: '1',
      unsupported_field_count_bucket: '0',
      has_shared_hooks: false
    })
    handler({}, 'setup_script_prompt_action', {
      action: 'configure_clicked',
      mode: 'configure_needed',
      file_count_bucket: '0',
      unsupported_field_count_bucket: '0',
      has_shared_hooks: true
    })
    expect(trackMock).toHaveBeenCalledWith('setup_script_prompt_shown', {
      mode: 'import_available',
      provider: 'codex',
      file_count_bucket: '1',
      unsupported_field_count_bucket: '0',
      has_shared_hooks: false,
      nth_repo_added: 3
    })
    expect(trackMock).toHaveBeenCalledWith('setup_script_prompt_action', {
      action: 'configure_clicked',
      mode: 'configure_needed',
      file_count_bucket: '0',
      unsupported_field_count_bucket: '0',
      has_shared_hooks: true,
      nth_repo_added: 3
    })
  })

  // Fail-soft: `nth_repo_added` is optional, so an undefined cohort still validates.
  it('forwards undefined cohort when the classifier returns undefined', () => {
    registerHandlers()
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: undefined })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'app_opened', {})
    expect(trackMock).toHaveBeenCalledWith('app_opened', { nth_repo_added: undefined })
  })

  // Security: same spread-order invariant as cohort — main-derived `nth_repo_added` overrides any renderer-forged value.
  it('main-derived nth_repo_added overrides renderer-supplied value', () => {
    registerHandlers()
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'app_opened', { nth_repo_added: 99 })
    expect(trackMock).toHaveBeenCalledWith('app_opened', { nth_repo_added: 2 })
  })

  // ── Onboarding cohort injection (mirrors the nth_repo_added pattern) ──

  it('injects onboarding cohort on events whose schema declares cohort', () => {
    registerHandlers()
    getOnboardingCohortAtEmitMock.mockReturnValue({ cohort: 'fresh_install' })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'onboarding_step_viewed', { step: 1, value_kind: 'agent' })
    expect(trackMock).toHaveBeenCalledWith('onboarding_step_viewed', {
      step: 1,
      value_kind: 'agent',
      cohort: 'fresh_install'
    })
  })

  it('does NOT inject onboarding cohort on non-onboarding events', () => {
    registerHandlers()
    const handler = handlers.get('telemetry:track')!
    handler({}, 'settings_changed', { setting_key: 'editorAutoSave', value_kind: 'bool' })
    expect(getOnboardingCohortAtEmitMock).not.toHaveBeenCalled()
  })

  it('forwards undefined onboarding cohort fail-soft', () => {
    registerHandlers()
    getOnboardingCohortAtEmitMock.mockReturnValue({ cohort: undefined })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'onboarding_started', {})
    expect(trackMock).toHaveBeenCalledWith('onboarding_started', { cohort: undefined })
  })

  // Security: main spreads cohort after caller props so main wins; flipping the order would let a renderer forge `cohort`.
  it('main-derived cohort overrides renderer-supplied cohort', () => {
    registerHandlers()
    getOnboardingCohortAtEmitMock.mockReturnValue({ cohort: 'fresh_install' })
    const handler = handlers.get('telemetry:track')!
    // Caller tries to forge cohort='upgrade_backfill'; main must overwrite.
    handler({}, 'onboarding_started', { cohort: 'upgrade_backfill' })
    expect(trackMock).toHaveBeenCalledWith('onboarding_started', {
      cohort: 'fresh_install'
    })
  })

  // Security: a fail-soft undefined cohort must still overwrite a forged value; a conditional-assign refactor would regress this.
  it('main-derived undefined cohort overrides renderer-supplied cohort (degraded classifier)', () => {
    registerHandlers()
    getOnboardingCohortAtEmitMock.mockReturnValue({ cohort: undefined })
    const handler = handlers.get('telemetry:track')!
    // Forged cohort='upgrade_backfill' is stripped by the explicit-undefined spread.
    handler({}, 'onboarding_started', { cohort: 'upgrade_backfill' })
    expect(trackMock).toHaveBeenCalledWith('onboarding_started', {
      cohort: undefined
    })
  })

  it('drops track calls with a non-string name', () => {
    registerHandlers()
    const handler = handlers.get('telemetry:track')!
    handler({}, 42, {})
    handler({}, null, {})
    handler({}, { event: 'app_opened' }, {})
    expect(trackMock).not.toHaveBeenCalled()
  })

  it('drops track calls with non-object props', () => {
    registerHandlers()
    const handler = handlers.get('telemetry:track')!
    handler({}, 'app_opened', 'string-not-object')
    handler({}, 'app_opened', 42)
    expect(trackMock).not.toHaveBeenCalled()
  })

  it('treats null/undefined props as an empty object', () => {
    registerHandlers()
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 0 })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'app_opened', null)
    handler({}, 'app_opened', undefined)
    expect(trackMock).toHaveBeenCalledTimes(2)
    expect(trackMock).toHaveBeenNthCalledWith(1, 'app_opened', { nth_repo_added: 0 })
    expect(trackMock).toHaveBeenNthCalledWith(2, 'app_opened', { nth_repo_added: 0 })
  })
})
