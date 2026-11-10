import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { interruptionFixture } from './interruption-fixture.test-support'
import { submitExitedAttempt } from './attempt-exit-submission'
import { stopHeadlessAttemptWatchers } from './headless-attempt-watcher'
import { accountKey } from '../agent-factory/account-cooldown'

let f: ReturnType<typeof interruptionFixture>
beforeEach(() => {
  f = interruptionFixture()
})
afterEach(async () => {
  stopHeadlessAttemptWatchers(f.runtime)
  await f.plane.effects.stop()
  vi.clearAllTimers()
  f.db.close()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
function audit(
  after: Parameters<typeof f.store.appendAuditEvent>[0]['after'],
  id = f.t01.attemptId
) {
  f.store.appendAuditEvent({
    missionId: f.mission.id,
    actor: 'AttemptLauncher',
    event: 'attempt.headless_prepared',
    objectKind: 'attempt',
    objectId: id,
    before: null,
    after
  })
}
it.each(['codex', 'claude'] as const)(
  'records the account of a usage-limited Attempt on its continuation',
  async (provider) => {
    f.prepare(f.t01.attemptId, provider)
    f.setEvents(
      provider === 'codex'
        ? [{ type: 'turn.failed', error: { message: 'Usage limit reached' } }]
        : [
            {
              type: 'result',
              subtype: 'error_during_execution',
              is_error: true,
              errors: ['Usage limit reached']
            }
          ]
    )
    const home = `/accounts/${provider}`
    audit({
      combination: {
        effective: {
          [provider === 'claude' ? 'claudeConfigDir' : 'codexHome']: { kind: 'account', path: home }
        }
      }
    })
    expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('interrupted')
    const effect = f.effect(1)
    expect(effect?.payload).toMatchObject({
      account: { provider, key: accountKey(provider, home) }
    })
    expect(JSON.stringify(effect)).not.toContain(home)
  }
)
it.each(['missing', 'malformed', 'empty', 'not_account', 'other_dispatch'])(
  'settles without an account for a %s launch audit',
  async (mode) => {
    if (mode !== 'missing') {
      audit(
        mode === 'malformed'
          ? { combination: null }
          : {
              combination: {
                effective: {
                  codexHome: {
                    kind: mode === 'not_account' ? 'ambient' : 'account',
                    path: mode === 'empty' ? '' : '/accounts/codex'
                  }
                }
              }
            },
        mode === 'other_dispatch' ? 'other-dispatch' : f.t01.attemptId
      )
    }
    expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('interrupted')
    expect(f.effect(1)?.payload).not.toHaveProperty('account')
  }
)
