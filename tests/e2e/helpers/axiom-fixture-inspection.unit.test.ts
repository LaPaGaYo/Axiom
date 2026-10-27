import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { recordHeadlessFixtureReceipts } from './axiom-fixture-inspection'

const database = vi.hoisted(() => ({ exec: vi.fn(), close: vi.fn() }))
vi.mock('../../../src/main/sqlite/sync-database', () => ({
  default: class {
    exec = database.exec
    close = database.close
    prepare() {
      return { all: () => [] }
    }
  }
}))
const scratch: string[] = []
afterEach(() => {
  vi.resetAllMocks()
  for (const directory of scratch.splice(0)) {rmSync(directory, { recursive: true, force: true })}
})

it.each([5, 6])(
  'skips a SQLite contention tick (%s) and reads again on the next tick',
  (errcode) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'axiom-receipts-'))
    scratch.push(directory)
    const ledger = path.join(directory, 'ledger.jsonl')
    database.exec.mockImplementationOnce(() => {
      throw Object.assign(new Error('database is locked'), { errcode })
    })
    expect(() => recordHeadlessFixtureReceipts(directory, 'mission', ledger)).not.toThrow()
    expect(existsSync(ledger)).toBe(false)
    expect(() => recordHeadlessFixtureReceipts(directory, 'mission', ledger)).not.toThrow()
    expect(database.exec).toHaveBeenCalledTimes(2)
    expect(database.close).toHaveBeenCalledTimes(2)
  }
)

it('still surfaces a non-contention inspection failure', () => {
  const failure = new Error('no such table: attempt_bindings')
  database.exec.mockImplementationOnce(() => {
    throw failure
  })
  expect(() => recordHeadlessFixtureReceipts('/absent', 'mission', '/absent/ledger')).toThrow(
    failure
  )
})
