import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as atomicFiles from '../codex-accounts/fs-utils'
import { restoreRealHomeHooksJson } from './codex-real-home-hooks-json'

vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }))

let root: string
let hooksPath: string
const generation = '{"hooks":{}}\n'
const previous = '{ "hooks": {} }\r\n'

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'axiom-hooks-rollback-'))
  hooksPath = join(root, 'hooks.json')
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('real-home hooks rollback generation', () => {
  it.each([previous, null])('restores %s while the written generation is unchanged', (raw) => {
    fs.writeFileSync(hooksPath, generation)

    restoreRealHomeHooksJson(hooksPath, raw, 0o600, generation)

    if (raw === null) {
      expect(fs.existsSync(hooksPath)).toBe(false)
    } else {
      expect(fs.readFileSync(hooksPath, 'utf8')).toBe(raw)
    }
  })

  it.each([previous, null])('leaves a later save alone instead of restoring %s', (raw) => {
    const saved = '{"hooks":{"Stop":[{"command":"user-hook"}]}}\n'
    fs.writeFileSync(hooksPath, saved)
    const write = vi.spyOn(atomicFiles, 'writeFileAtomically')
    const unlink = vi.spyOn(fs, 'unlinkSync')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    restoreRealHomeHooksJson(hooksPath, raw, 0o600, generation)

    expect(fs.readFileSync(hooksPath, 'utf8')).toBe(saved)
    expect(write).not.toHaveBeenCalled()
    expect(unlink).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      '[codex-real-home-hooks] hooks.json changed during the trust session; leaving it as found',
      { path: hooksPath }
    )
  })

  it('does not resurrect a file deleted during the session', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    restoreRealHomeHooksJson(hooksPath, previous, 0o600, generation)

    expect(fs.existsSync(hooksPath)).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
