import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { SCHEMA_VERSION } from '../contract-constants'
import { OrchestrationDb } from '../orchestration-db'

const databases = new Set<OrchestrationDb>()
const directories: string[] = []
const verificationColumns = (db: OrchestrationDb) =>
  db.db
    .prepare('PRAGMA table_info(verification_runs)')
    .all()
    .map((row) => row.name)
const verificationSql = (db: OrchestrationDb) =>
  db.db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'verification_runs'")
    .get()?.sql

function openDatabase(path: string): OrchestrationDb {
  const db = new OrchestrationDb(path)
  databases.add(db)
  return db
}

function closeDatabase(db: OrchestrationDb): void {
  db.close()
  databases.delete(db)
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const db of databases) {
    db.close()
  }
  databases.clear()
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true })
  }
  directories.length = 0
})

it('adds batch_id to an existing verification_runs table at open and keeps the schema version', () => {
  const directory = mkdtempSync(join(tmpdir(), 'axiom-batch-column-'))
  directories.push(directory)
  for (const version of [46, 45]) {
    const path = join(directory, `v${version}.db`)
    const first = openDatabase(path)
    const freshColumns = verificationColumns(first)
    first.db
      .prepare(`INSERT INTO verification_runs
      (id, mission_id, candidate_id, task_id, status, verdict_detail, commands, tool_versions,
       verifier, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        'run',
        'mission',
        'candidate',
        'task',
        'QUEUED',
        '{"phase":"queued"}',
        '["pnpm test"]',
        '{"node":"24"}',
        'VerificationService',
        'created',
        'updated'
      )
    first.db.exec('ALTER TABLE verification_runs DROP COLUMN batch_id')
    if (version === 45) {
      for (const column of [
        'runtime_epoch',
        'claim_count',
        'worktree_id',
        'started_at',
        'finished_at'
      ]) {
        first.db.exec(`ALTER TABLE verification_runs DROP COLUMN ${column}`)
      }
      first.db.pragma('user_version = 45')
    }
    const before = first.db.prepare('SELECT * FROM verification_runs').get()
    closeDatabase(first)

    const reopened = openDatabase(path)
    expect(
      version === 46 ? verificationColumns(reopened) : verificationColumns(reopened).sort()
    ).toEqual(version === 46 ? freshColumns : [...freshColumns].sort())
    if (version === 46) {
      expect(verificationColumns(reopened).at(-1)).toBe('batch_id')
    }
    const expected = {
      ...before,
      runtime_epoch: null,
      claim_count: 0,
      worktree_id: null,
      started_at: null,
      finished_at: null,
      batch_id: null
    }
    expect(reopened.db.prepare('SELECT * FROM verification_runs').get()).toEqual(expected)
    expect(reopened.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(46)
    const sql = verificationSql(reopened)
    closeDatabase(reopened)

    const again = openDatabase(path)
    expect(verificationSql(again)).toBe(sql)
    expect(again.db.prepare('SELECT * FROM verification_runs').get()).toEqual(expected)
    expect(again.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    closeDatabase(again)
  }
})
