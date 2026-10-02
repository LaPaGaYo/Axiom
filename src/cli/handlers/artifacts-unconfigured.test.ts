import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARTIFACT_HANDLERS } from './artifacts'
import { main } from '../index'

beforeEach(() => {
  vi.stubEnv('ORCA_ARTIFACTS_API_URL', '')
})
afterEach(() => {
  process.exitCode = 0
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('unconfigured artifact CLI', () => {
  it.each(Object.keys(ARTIFACT_HANDLERS))(
    '%s fails before reading runtime or input',
    async (command) => {
      const getClient = vi.fn((): never => {
        throw new Error('unexpected runtime access')
      })
      await expect(
        ARTIFACT_HANDLERS[command]!({
          flags: new Map(),
          cwd: '/unused',
          json: false,
          get client() {
            return getClient()
          }
        })
      ).rejects.toMatchObject({
        code: 'unconfigured',
        message: 'Artifact sharing is not configured in this build.'
      })
      expect(getClient).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['artifacts', 'share', '--json'],
    ['artifacts', 'share', '--file', '/unused/report.html', '--json']
  ])('returns a typed error with a failing exit code for %j', async (...args) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await main(args)
    expect(log).toHaveBeenCalledWith(JSON.stringify({ ok: false, reason: 'unconfigured' }))
    expect(process.exitCode).toBe(1)
  })

  it('explains the unconfigured result in human output', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await main(['artifacts', 'share', '--file', '/unused/report.html'])
    expect(error).toHaveBeenCalledWith('Artifact sharing is not configured in this build.')
    expect(process.exitCode).toBe(1)
  })

  it('preserves explicit environment configuration', async () => {
    vi.stubEnv('ORCA_ARTIFACTS_API_URL', 'http://localhost:3000')
    const getClient = vi.fn((): never => {
      throw new Error('configured runtime reached')
    })
    await expect(
      ARTIFACT_HANDLERS['artifacts list']!({
        flags: new Map(),
        cwd: '/unused',
        json: false,
        get client() {
          return getClient()
        }
      })
    ).rejects.toThrow('configured runtime reached')
    expect(getClient).toHaveBeenCalledOnce()
  })
})
