import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentTokenUsageSchema } from '../../shared/telemetry-agent-token-usage-schema'
import { _setShuttingDownForTests, isTelemetryEnabled } from '../telemetry/client'
import {
  cleanupTelemetryClientTest,
  setupTelemetryClientTest,
  type TelemetryClientTestState
} from '../telemetry/client-test-harness'
import { AgentTokenUsageReporter } from './agent-token-usage-reporter'

const ID = '00000000-0000-4000-8000-000000000001'
const row = {
  providerSessionId: 'private-provider-session',
  input_tokens: 100,
  output_tokens: 20,
  cached_input_tokens: 50,
  cache_write_input_tokens: 10
}
let directory: string
let telemetry: TelemetryClientTestState
const identity = vi.fn(async (ids: readonly string[]) => ids.map(() => ID))

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'axiom-token-usage-'))
  telemetry = setupTelemetryClientTest()
  identity.mockClear()
})
afterEach(() => {
  cleanupTelemetryClientTest()
  rmSync(directory, { recursive: true, force: true })
})

describe('local-only agent token usage policy', () => {
  it.each(['opt-in', 'opt-out', 'pending', 'environment', 'shutdown'])(
    'does no analytics identity or disk work for %s',
    async (gate) => {
      if (telemetry.settings.telemetry) {
        telemetry.settings.telemetry.optedIn = gate === 'pending' ? null : gate !== 'opt-out'
      }
      if (gate === 'environment') {
        vi.stubEnv('DO_NOT_TRACK', '1')
      }
      if (gate === 'shutdown') {
        _setShuttingDownForTests(true)
      }
      const file = join(directory, 'tokens.json')
      const reporter = new AgentTokenUsageReporter(file, 'claude', identity)
      await reporter.report([row])
      await reporter.flush()
      expect(isTelemetryEnabled()).toBe(false)
      expect(identity).not.toHaveBeenCalled()
      expect(existsSync(file)).toBe(false)
    }
  )

  it('retains the upstream strict event schema without private content fields', () => {
    const payload = { ...row, analytics_session_id: ID, revision: 1, provider: 'claude' }
    expect(agentTokenUsageSchema.safeParse(payload).success).toBe(false)
    const { providerSessionId: _, ...valid } = payload
    expect(agentTokenUsageSchema.safeParse(valid).success).toBe(true)
    expect(agentTokenUsageSchema.safeParse({ ...valid, input_tokens: -1 }).success).toBe(false)
    for (const field of ['prompt', 'path', 'model', 'activity_timestamp', 'estimated_cost']) {
      expect(agentTokenUsageSchema.safeParse({ ...valid, [field]: 'private' }).success).toBe(false)
    }
  })
})
