import { getAppEnvironment, hasAppEnvironment } from '../../../../../shared/app-environment'
import type Database from '../../../../sqlite/sync-database'

export const AXIOM_SCHEMA_VERSION = 1
export const AXIOM_UPSTREAM_SCHEMA_VERSION = 43

function migrateAxiomBaseline(db: Database.Database): void {
  for (const [table, column, definition] of [
    ['agent_specs', 'spec', "TEXT NOT NULL DEFAULT '{}'"],
    ['mission_policies', 'routing', "TEXT NOT NULL DEFAULT '{}'"],
    ['verification_runs', 'runtime_epoch', 'TEXT'],
    ['verification_runs', 'claim_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['verification_runs', 'worktree_id', 'TEXT'],
    ['verification_runs', 'started_at', 'TEXT'],
    ['verification_runs', 'finished_at', 'TEXT'],
    ['verification_runs', 'batch_id', 'TEXT']
  ]) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all()
    if (!columns.some((row) => row.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }
}

// Every step probes before changing anything so a lost stamp can safely replay all steps.
// Never remove or redefine objects earlier builds supply when missing: their DDL would restore them.
const AXIOM_SCHEMA_STEPS = [{ version: 1, apply: migrateAxiomBaseline }]

export function readAxiomSchemaVersion(db: Database.Database): number {
  const version = db.prepare('SELECT version FROM axiom_schema WHERE id = 1').get()?.version
  return typeof version === 'number' && Number.isInteger(version) && version > 0 ? version : 0
}

export function migrateAxiomSchema(db: Database.Database, appVersion?: string | null): void {
  db.exec(`CREATE TABLE IF NOT EXISTS axiom_schema (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    version INTEGER NOT NULL,
    upstream_version INTEGER NOT NULL,
    app_version TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  if (readAxiomSchemaVersion(db) >= AXIOM_SCHEMA_VERSION) {
    return
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    const current = readAxiomSchemaVersion(db)
    if (current < AXIOM_SCHEMA_VERSION) {
      for (const step of AXIOM_SCHEMA_STEPS) {
        if (step.version > current) {
          step.apply(db)
        }
      }
      const version =
        appVersion === undefined
          ? hasAppEnvironment()
            ? getAppEnvironment().getVersion()
            : null
          : appVersion
      db.prepare(`INSERT INTO axiom_schema (id, version, upstream_version, app_version, updated_at)
        VALUES (1, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET version = excluded.version,
          app_version = excluded.app_version, updated_at = excluded.updated_at`).run(
        AXIOM_SCHEMA_VERSION,
        AXIOM_UPSTREAM_SCHEMA_VERSION,
        version
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
