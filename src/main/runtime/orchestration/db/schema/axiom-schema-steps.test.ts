import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { installFakeAppEnvironment } from '../../../../../../config/scripts/vitest-host-ports-setup'
import type Database from '../../../../sqlite/sync-database'
import { OrchestrationDb } from '../orchestration-db'
import {
  AXIOM_SCHEMA_VERSION,
  AXIOM_UPSTREAM_SCHEMA_VERSION,
  migrateAxiomSchema,
  readAxiomSchemaVersion
} from './axiom-schema-steps'

const databases = new Set<OrchestrationDb>()
const directories: string[] = []
// Independent column contract, including SQLite type, nullability and default expression.
const BASELINE_COLUMNS = [
  ['agent_specs', 'spec', 'TEXT', 1, "'{}'"],
  ['mission_policies', 'routing', 'TEXT', 1, "'{}'"],
  ['verification_runs', 'runtime_epoch', 'TEXT', 0, null],
  ['verification_runs', 'claim_count', 'INTEGER', 1, '0'],
  ['verification_runs', 'worktree_id', 'TEXT', 0, null],
  ['verification_runs', 'started_at', 'TEXT', 0, null],
  ['verification_runs', 'finished_at', 'TEXT', 0, null],
  ['verification_runs', 'batch_id', 'TEXT', 0, null]
] as const
const SEEDED_TABLES = ['agent_specs', 'mission_policies', 'verification_runs', 'artifacts']

function schemaRows(db: Database.Database) {
  return db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all()
}

function seededRows(db: Database.Database) {
  return SEEDED_TABLES.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
}

function seedRows(db: Database.Database): void {
  db.exec(`
    INSERT INTO agent_specs
      (id, mission_id, role, provider, model, workspace_strategy, permissions, created_at)
      VALUES ('spec', 'mission', 'worker', 'codex', 'test', 'worktree', '{"read":true}', 'created');
    INSERT INTO mission_policies (mission_id, concurrency_limit, budget, created_at, updated_at)
      VALUES ('mission', 3, '{"maxAttempts":5}', 'created', 'updated');
    INSERT INTO verification_runs
      (id, mission_id, candidate_id, task_id, status, commands, verifier, created_at, updated_at)
      VALUES ('verification', 'mission', 'candidate', 'task', 'QUEUED', '["pnpm test"]',
        'VerificationService', 'created', 'updated');
    INSERT INTO artifacts (id, mission_id, kind, sha256, size_bytes, media_type, created_by)
      VALUES ('artifact', 'mission', 'report', 'digest', 7, 'text/plain', 'worker');
  `)
}

function dropBaselineColumns(db: Database.Database): void {
  for (const [table, column] of BASELINE_COLUMNS) {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`)
  }
  db.exec('DELETE FROM axiom_schema')
}

function expectBaselineColumns(db: Database.Database): void {
  for (const [table, name, type, notnull, dflt_value] of BASELINE_COLUMNS) {
    expect(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .find((row) => row.name === name)
    ).toMatchObject({
      name,
      type,
      notnull,
      dflt_value
    })
  }
}

function openDatabase(path = ':memory:'): OrchestrationDb {
  const db = new OrchestrationDb(path)
  databases.add(db)
  return db
}

function closeDatabase(db: OrchestrationDb): void {
  db.close()
  databases.delete(db)
}

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'axiom-schema-steps-'))
  directories.push(directory)
  return join(directory, 'orchestration.db')
}

afterEach(() => {
  vi.restoreAllMocks()
  installFakeAppEnvironment()
  for (const db of databases) {
    db.close()
  }
  databases.clear()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('a fresh database is stamped with the Axiom schema version', () => {
  const { db } = openDatabase()
  expect(
    db
      .prepare('PRAGMA table_info(axiom_schema)')
      .all()
      .map((row) => row.name)
  ).toEqual(['id', 'version', 'upstream_version', 'app_version', 'updated_at'])
  expect(db.prepare('SELECT * FROM axiom_schema').all()).toEqual([
    {
      id: 1,
      version: 1,
      upstream_version: 43,
      app_version: '0.0.0-test',
      updated_at: expect.any(String)
    }
  ])
  expect(db.pragma('user_version', { simple: true })).toBe(46)
  expect(AXIOM_SCHEMA_VERSION).toBe(1)
  expect(AXIOM_UPSTREAM_SCHEMA_VERSION).toBe(43)
  expect(readAxiomSchemaVersion(db)).toBe(1)
  expect(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE tbl_name = 'axiom_schema' AND type IN ('index', 'trigger')"
      )
      .all()
  ).toEqual([])
  const insert = db.prepare(
    'INSERT INTO axiom_schema (id, version, upstream_version) VALUES (?, 1, 43)'
  )
  expect(() => insert.run(2)).toThrow(/CHECK constraint failed/)
  expect(() => insert.run(1)).toThrow(/UNIQUE constraint failed/)
})

it('a database written before the stamp existed is stamped without any other change', () => {
  const path = databasePath()
  const first = openDatabase(path)
  seedRows(first.db)
  first.db.exec('DROP TABLE axiom_schema')
  const schema = schemaRows(first.db)
  const rows = seededRows(first.db)
  closeDatabase(first)

  const reopened = openDatabase(path)
  expect(schemaRows(reopened.db).filter((row) => row.name !== 'axiom_schema')).toEqual(schema)
  expect(seededRows(reopened.db)).toEqual(rows)
  expect(reopened.db.prepare('SELECT * FROM axiom_schema').all()).toEqual([
    {
      id: 1,
      version: 1,
      upstream_version: 43,
      app_version: '0.0.0-test',
      updated_at: expect.any(String)
    }
  ])
  expect(reopened.db.pragma('user_version', { simple: true })).toBe(46)
})

it('the baseline alone supplies every column Axiom added to existing tables', () => {
  const { db } = openDatabase()
  seedRows(db)
  dropBaselineColumns(db)
  const specs = db.prepare('SELECT * FROM agent_specs').all()
  const policies = db.prepare('SELECT * FROM mission_policies').all()
  const runs = db.prepare('SELECT * FROM verification_runs').all()

  migrateAxiomSchema(db)

  expectBaselineColumns(db)
  expect(db.prepare('SELECT * FROM agent_specs').all()).toEqual([{ ...specs[0], spec: '{}' }])
  expect(db.prepare('SELECT * FROM mission_policies').all()).toEqual([
    { ...policies[0], routing: '{}' }
  ])
  expect(db.prepare('SELECT * FROM verification_runs').all()).toEqual([
    {
      ...runs[0],
      runtime_epoch: null,
      claim_count: 0,
      worktree_id: null,
      started_at: null,
      finished_at: null,
      batch_id: null
    }
  ])
  expect(readAxiomSchemaVersion(db)).toBe(1)
  expect(db.pragma('user_version', { simple: true })).toBe(46)
})

it('opening a stamped database again changes neither the row nor the schema', () => {
  const path = databasePath()
  const first = openDatabase(path)
  first.db.exec("UPDATE axiom_schema SET updated_at = 'unchanged-marker'")
  const row = first.db.prepare('SELECT * FROM axiom_schema').get()
  const schema = schemaRows(first.db)
  closeDatabase(first)

  for (let count = 0; count < 2; count++) {
    const reopened = openDatabase(path)
    expect(reopened.db.prepare('SELECT * FROM axiom_schema').get()).toEqual(row)
    expect(schemaRows(reopened.db)).toEqual(schema)
    closeDatabase(reopened)
  }
})

it('a stamp from a newer Axiom is left as it is', () => {
  const path = databasePath()
  const first = openDatabase(path)
  first.db.exec(`UPDATE axiom_schema
    SET version = 99, upstream_version = 97, app_version = '99.0.0', updated_at = 'future-marker'`)
  const row = first.db.prepare('SELECT * FROM axiom_schema').get()
  const schema = schemaRows(first.db)
  closeDatabase(first)

  const reopened = openDatabase(path)
  expect(reopened.db.prepare('SELECT * FROM axiom_schema').get()).toEqual(row)
  expect(schemaRows(reopened.db)).toEqual(schema)
  expect(readAxiomSchemaVersion(reopened.db)).toBe(99)
})

it('a missing stamp is repaired by running the steps again', () => {
  const path = databasePath()
  const first = openDatabase(path)
  seedRows(first.db)
  first.db.exec('DELETE FROM axiom_schema')
  expect(readAxiomSchemaVersion(first.db)).toBe(0)
  const schema = schemaRows(first.db)
  const rows = seededRows(first.db)
  closeDatabase(first)

  const reopened = openDatabase(path)
  expect(readAxiomSchemaVersion(reopened.db)).toBe(1)
  expect(reopened.db.prepare('SELECT * FROM axiom_schema').all()).toEqual([
    {
      id: 1,
      version: 1,
      upstream_version: 43,
      app_version: '0.0.0-test',
      updated_at: expect.any(String)
    }
  ])
  expect(schemaRows(reopened.db)).toEqual(schema)
  expect(seededRows(reopened.db)).toEqual(rows)

  for (const invalidVersion of [0, -1, 1.5, 'invalid']) {
    reopened.db
      .prepare(`UPDATE axiom_schema SET version = ?, upstream_version = 73,
      app_version = 'old', updated_at = 'old-marker'`)
      .run(invalidVersion)
    expect(readAxiomSchemaVersion(reopened.db)).toBe(0)
    migrateAxiomSchema(reopened.db, 'repair-version')
    expect(reopened.db.prepare('SELECT * FROM axiom_schema').get()).toEqual({
      id: 1,
      version: 1,
      upstream_version: 73,
      app_version: 'repair-version',
      updated_at: expect.any(String)
    })
    expect(reopened.db.prepare('SELECT updated_at FROM axiom_schema').get()?.updated_at).not.toBe(
      'old-marker'
    )
  }
})

it('a step that fails leaves no partial change and the next run succeeds', () => {
  const { db } = openDatabase()
  seedRows(db)
  dropBaselineColumns(db)
  const schema = schemaRows(db)
  const rows = seededRows(db)
  const failure = new Error('baseline final column fault')
  const exec = db.exec.bind(db)
  let failOnce = true
  const spy = vi.spyOn(db, 'exec').mockImplementation((sql) => {
    if (sql === 'ALTER TABLE verification_runs ADD COLUMN batch_id TEXT' && failOnce) {
      failOnce = false
      throw failure
    }
    exec(sql)
  })

  expect(() => migrateAxiomSchema(db)).toThrow(failure)
  expect(schemaRows(db)).toEqual(schema)
  expect(seededRows(db)).toEqual(rows)
  expect(db.prepare('SELECT * FROM axiom_schema').all()).toEqual([])
  expect(db.isTransaction).toBe(false)
  for (const [table, column] of BASELINE_COLUMNS) {
    expect(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((row) => row.name === column)
    ).toBe(false)
  }
  spy.mockRestore()

  migrateAxiomSchema(db)
  expectBaselineColumns(db)
  expect(readAxiomSchemaVersion(db)).toBe(1)
  expect(db.isTransaction).toBe(false)
})

it('the stamp records the app version it is given', () => {
  installFakeAppEnvironment({ getVersion: () => '1.2.3-schema-test' })
  const { db } = openDatabase()
  expect(db.prepare('SELECT app_version FROM axiom_schema').get()?.app_version).toBe(
    '1.2.3-schema-test'
  )

  db.exec('DELETE FROM axiom_schema')
  migrateAxiomSchema(db, '4.5.6-explicit-test')
  expect(db.prepare('SELECT app_version FROM axiom_schema').get()?.app_version).toBe(
    '4.5.6-explicit-test'
  )

  db.exec('DELETE FROM axiom_schema')
  migrateAxiomSchema(db, null)
  expect(db.prepare('SELECT app_version FROM axiom_schema').get()?.app_version).toBeNull()
})
