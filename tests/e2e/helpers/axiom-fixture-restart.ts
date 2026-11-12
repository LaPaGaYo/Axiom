import { cleanupE2EDaemons } from './electron-process-shutdown'

export type FixtureRestartOptions = { stopDaemons?: boolean }

/** Called after the app closes, before the next launch. Warm restart remains the default. */
export async function stopFixtureDaemonsForRestart(
  userDataDir: string,
  options?: FixtureRestartOptions
) {
  if (options?.stopDaemons) {
    await cleanupE2EDaemons(userDataDir)
  }
}
