import { afterEach, beforeEach, vi } from 'vitest'

/** D83 ruling ①: mirror, write-back and real-home hook tests now cover Windows only. */
export function setupLegacyWindowsCodexHome(): void {
  let restore: (() => void) | undefined
  beforeEach(() => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    restore = () => platform.mockRestore()
  })
  afterEach(() => restore?.())
}
