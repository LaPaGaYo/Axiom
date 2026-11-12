import { beforeEach, expect, it, vi } from 'vitest'
import { cleanupE2EDaemons } from './electron-process-shutdown'
import { stopFixtureDaemonsForRestart } from './axiom-fixture-restart'

vi.mock('./electron-process-shutdown', () => ({ cleanupE2EDaemons: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

it('keeps the profile daemons for a default fixture restart', async () => {
  await stopFixtureDaemonsForRestart('/fixture/profile')
  await stopFixtureDaemonsForRestart('/fixture/profile', { stopDaemons: false })
  expect(cleanupE2EDaemons).not.toHaveBeenCalled()
})
it('awaits stopping only the selected profile daemons before relaunch', async () => {
  let complete: () => void = () => {
    throw new Error('Cleanup has not started')
  }
  vi.mocked(cleanupE2EDaemons).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve
      })
  )
  const resumed = vi.fn()
  const pending = stopFixtureDaemonsForRestart('/fixture/profile', { stopDaemons: true }).then(
    resumed
  )
  await Promise.resolve()
  expect(cleanupE2EDaemons).toHaveBeenCalledExactlyOnceWith('/fixture/profile')
  expect(resumed).not.toHaveBeenCalled()
  complete()
  await pending
  expect(resumed).toHaveBeenCalledTimes(1)
})
