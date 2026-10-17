import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../../../sqlite/sync-database'
import { resolveOrchestrationMigrationStartVersion } from '../../orchestration-schema-version-skew'
import { SCHEMA_VERSION } from '../contract-constants'
import { OrchestrationDb } from '../orchestration-db'
import { migrateV43 } from './migrate-v43'

// Independent contract from orca-mapping §6 and M1-03; do not derive this from the DDL.
const TABLE_COLUMNS: Record<string, string> = {
  missions:
    'id run_id coordinator_orca_session_id repo_id repo_path target_branch status active_goal_revision_id active_plan_revision_id previous_status created_at updated_at',
  goal_revisions:
    'id mission_id revision status objective constraints acceptance_criteria provenance created_at updated_at',
  plan_revisions:
    'id mission_id revision status goal_revision_id milestones risks proposal supersedes_id rejected_reason provenance created_at updated_at',
  task_stages:
    'task_id mission_id plan_revision_id stage previous_stage spec retry_policy attempt_count created_at updated_at',
  mission_task_edges:
    'mission_id from_task_id to_task_id readiness_threshold plan_revision_id created_at updated_at',
  agent_specs:
    'id mission_id role provider model reasoning permissions budget workspace_strategy created_at spec',
  attempt_bindings:
    'task_id mission_id seq branch dispatch_id agent_spec_id context_package_id created_at updated_at',
  context_packages:
    'id mission_id task_id plan_revision_id manifest token_budget mandatory_refs ranked_refs created_at',
  submissions:
    'id mission_id dispatch_id task_id candidate_id report checks_run limitations follow_ups created_at',
  candidates:
    'id mission_id dispatch_id task_id commit_sha tree_sha status superseded_by created_at updated_at',
  artifacts: 'id mission_id kind sha256 size_bytes media_type related created_by created_at',
  decisions:
    'id mission_id status title options resolution authority provenance supersedes_id created_at updated_at',
  verification_runs:
    'id mission_id candidate_id task_id status verdict_detail commands tool_versions verifier created_at updated_at',
  integration_batches:
    'id mission_id base_commit candidate_ids status merge_commit conflicts approval_id created_at updated_at',
  approvals:
    'id mission_id action_kind inputs_hash risk status expires_at resolver requested_by resolution outcome executed_at created_at updated_at',
  mission_policies:
    'mission_id concurrency_limit budget readiness_threshold approval_rules verification_rules nested_worker_max_depth unverifiable_tolerance_minutes created_at updated_at routing',
  audit_events: 'sequence mission_id actor object_kind object_id event before after created_at'
}

const INDEX_COLUMNS: Record<string, string[]> = {
  idx_task_stages_mission_stage: ['mission_id', 'stage'],
  idx_mission_task_edges_to_task: ['to_task_id'],
  idx_goal_revisions_mission: ['mission_id'],
  idx_plan_revisions_mission_status: ['mission_id', 'status'],
  idx_audit_events_mission_sequence: ['mission_id', 'sequence'],
  idx_candidates_task_status: ['task_id', 'status'],
  idx_verification_runs_candidate: ['candidate_id'],
  idx_integration_batches_mission_status: ['mission_id', 'status'],
  idx_approvals_mission_status: ['mission_id', 'status']
}

const TRIGGERS = ['trg_tasks_delete_axiom', 'trg_dispatches_delete_axiom', 'trg_runs_delete_axiom']

function axiomSchema(db: Database): string {
  return JSON.stringify(
    db
      .prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name')
      .all()
      .filter(
        (row) =>
          Object.hasOwn(TABLE_COLUMNS, String(row.tbl_name)) || TRIGGERS.includes(String(row.name))
      )
  )
}

function dropAxiomSchema(db: Database): void {
  for (const name of TRIGGERS) {
    db.exec(`DROP TRIGGER IF EXISTS ${name}`)
  }
  // Dropping a table also drops its indexes, including implicit UNIQUE indexes.
  for (const name of Object.keys(TABLE_COLUMNS)) {
    db.exec(`DROP TABLE IF EXISTS ${name}`)
  }
}

function seedMission(db: Database, id: string): void {
  const runId = `run-${id}`
  db.prepare('INSERT INTO runs (id, objective) VALUES (?, ?)').run(runId, 'keep Orca run')
  db.prepare('INSERT INTO tasks (id, run_id, spec) VALUES (?, ?, ?)').run(
    id,
    runId,
    'keep Orca task'
  )
  db.prepare('INSERT INTO dispatch_contexts (id, run_id, task_id) VALUES (?, ?, ?)').run(
    id,
    runId,
    id
  )
  db.prepare(`INSERT INTO missions (id, run_id, coordinator_orca_session_id, repo_id, repo_path, target_branch, status)
    VALUES (?, ?, ?, 'repo', '/repository', 'main', 'DRAFT')`).run(id, runId, `axiom-mission-${id}`)
  const rows: Record<string, Record<string, string | number>> = {
    goal_revisions: { id, revision: 1, status: 'ACTIVE', objective: 'goal' },
    plan_revisions: { id, revision: 1, status: 'APPROVED', goal_revision_id: id },
    task_stages: { task_id: id, plan_revision_id: id, stage: 'DEFINED' },
    mission_task_edges: { from_task_id: id, to_task_id: `${id}-next`, plan_revision_id: id },
    agent_specs: {
      id,
      role: 'worker',
      provider: 'codex',
      model: 'test',
      workspace_strategy: 'worktree'
    },
    attempt_bindings: {
      task_id: id,
      seq: 1,
      branch: `axiom/attempt/${id}/1`,
      dispatch_id: id,
      agent_spec_id: id,
      context_package_id: id
    },
    context_packages: { id, task_id: id, plan_revision_id: id, token_budget: 1000 },
    submissions: { id, dispatch_id: id, task_id: id, candidate_id: id },
    candidates: {
      id,
      dispatch_id: id,
      task_id: id,
      commit_sha: 'commit',
      tree_sha: 'tree',
      status: 'ACTIVE'
    },
    artifacts: {
      id,
      kind: 'report',
      sha256: 'hash',
      size_bytes: 1,
      media_type: 'text/plain',
      created_by: 'worker'
    },
    decisions: { id, status: 'PROPOSED', title: 'decision', authority: 'user' },
    verification_runs: {
      id,
      candidate_id: id,
      task_id: id,
      status: 'QUEUED',
      verifier: 'verifier'
    },
    integration_batches: { id, base_commit: 'base', status: 'QUEUED' },
    approvals: {
      id,
      action_kind: 'delivery',
      inputs_hash: 'hash',
      risk: 'high',
      status: 'PENDING',
      expires_at: '2027-01-01',
      requested_by: 'user'
    },
    mission_policies: { concurrency_limit: 3 },
    audit_events: { actor: 'user', object_kind: 'mission', object_id: id, event: 'created' }
  }
  for (const [table, row] of Object.entries(rows)) {
    const values = { mission_id: id, ...row }
    db.prepare(
      `INSERT INTO ${table} (${Object.keys(values).join(', ')}) VALUES (${Object.keys(values)
        .map(() => '?')
        .join(', ')})`
    ).run(...Object.values(values))
  }
}

describe('Axiom v43 side tables', () => {
  const roots: string[] = []
  const databases = new Set<OrchestrationDb>()

  function open(path = ':memory:'): OrchestrationDb {
    const db = new OrchestrationDb(path)
    databases.add(db)
    return db
  }

  function close(db: OrchestrationDb): void {
    db.close()
    databases.delete(db)
  }

  function filePath(): string {
    const root = mkdtempSync(join(tmpdir(), 'axiom-v43-'))
    roots.push(root)
    return join(root, 'orchestration.db')
  }

  afterEach(() => {
    for (const db of databases) {
      db.close()
    }
    databases.clear()
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('creates all 17 tables, specified columns, indexes and three triggers on a fresh database', () => {
    const { db } = open()
    expect(SCHEMA_VERSION).toBe(44)
    expect(db.pragma('user_version', { simple: true })).toBe(44)
    expect(Object.keys(TABLE_COLUMNS)).toHaveLength(17)
    for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
      ).toEqual({ name: table })
      expect(
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((row) => row.name),
        table
      ).toEqual(columns.split(' '))
      expect(db.prepare(`PRAGMA foreign_key_list(${table})`).all(), table).toEqual([])
    }
    for (const [index, columns] of Object.entries(INDEX_COLUMNS)) {
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(index)
      ).toEqual({ name: index })
      expect(
        db
          .prepare(`PRAGMA index_info(${index})`)
          .all()
          .map((row) => row.name),
        index
      ).toEqual(columns)
    }
    for (const name of TRIGGERS) {
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name)
      ).toEqual({ name })
    }
  })

  it('upgrades a v42 file without changing its Orca run or task', () => {
    const path = filePath()
    const seeded = open(path)
    seedMission(seeded.db, 'kept')
    const run = seeded.db.prepare('SELECT * FROM runs WHERE id = ?').get('run-kept')
    const task = seeded.db.prepare('SELECT * FROM tasks WHERE id = ?').get('kept')
    close(seeded)
    const previous = new Database(path)
    try {
      dropAxiomSchema(previous)
      previous.pragma('user_version = 42')
      expect(axiomSchema(previous)).toBe('[]')
      expect(resolveOrchestrationMigrationStartVersion(previous, 42, SCHEMA_VERSION)).toBe(42)
    } finally {
      previous.close()
    }
    const migrated = open(path)
    expect(migrated.db.pragma('user_version', { simple: true })).toBe(44)
    expect(axiomSchema(migrated.db)).toBe(axiomSchema(open().db))
    expect(migrated.db.prepare('SELECT * FROM runs WHERE id = ?').get('run-kept')).toEqual(run)
    expect(migrated.db.prepare('SELECT * FROM tasks WHERE id = ?').get('kept')).toEqual(task)
  })

  it('upgrades v43 columns without changing rows and reopens idempotently', () => {
    const path = filePath()
    const first = open(path)
    seedMission(first.db, 'kept')
    first.db.exec('ALTER TABLE agent_specs DROP COLUMN spec')
    first.db.exec('ALTER TABLE mission_policies DROP COLUMN routing')
    first.db.pragma('user_version = 43')
    const spec = first.db.prepare('SELECT * FROM agent_specs').get()
    const policy = first.db.prepare('SELECT * FROM mission_policies').get()
    close(first)
    const upgraded = open(path)
    expect(upgraded.db.pragma('user_version', { simple: true })).toBe(44)
    expect(upgraded.db.prepare('SELECT * FROM agent_specs').get()).toEqual({ ...spec, spec: '{}' })
    expect(upgraded.db.prepare('SELECT * FROM mission_policies').get()).toEqual({
      ...policy,
      routing: '{}'
    })
    const schema = axiomSchema(upgraded.db)
    close(upgraded)
    const reopened = open(path)
    expect(axiomSchema(reopened.db)).toBe(schema)
    expect(reopened.db.prepare('SELECT * FROM agent_specs').get()).toEqual({ ...spec, spec: '{}' })
    expect(reopened.db.prepare('SELECT * FROM mission_policies').get()).toEqual({
      ...policy,
      routing: '{}'
    })
  })

  it('keeps the Axiom sqlite_master definitions byte-identical across reopen', () => {
    const path = filePath()
    const first = open(path)
    const before = axiomSchema(first.db)
    expect(before).toContain('missions')
    close(first)
    const second = open(path)
    expect(axiomSchema(second.db)).toBe(before)
    close(second)
    expect(axiomSchema(open(path).db)).toBe(before)
  })

  it('repairs indexes and triggers in v43 only when the prior version requires migration', () => {
    const orchestration = open()
    const { db } = orchestration
    const before = axiomSchema(db)
    for (const index of Object.keys(INDEX_COLUMNS)) {
      db.exec(`DROP INDEX ${index}`)
    }
    for (const trigger of TRIGGERS) {
      db.exec(`DROP TRIGGER ${trigger}`)
    }
    const missing = axiomSchema(db)
    expect(missing).not.toBe(before)
    migrateV43.call(orchestration, 43)
    expect(axiomSchema(db)).toBe(missing)
    migrateV43.call(orchestration, 44)
    expect(axiomSchema(db)).toBe(missing)
    migrateV43.call(orchestration, 42)
    expect(axiomSchema(db)).toBe(before)
  })

  it('preserves a future version stamp and remains transparent to the downgrade probe', () => {
    const path = filePath()
    const first = open(path)
    seedMission(first.db, 'future')
    const before = axiomSchema(first.db)
    first.db.pragma('user_version = 45')
    close(first)
    const { db } = open(path)
    expect(db.pragma('user_version', { simple: true })).toBe(45)
    expect(resolveOrchestrationMigrationStartVersion(db, 45, SCHEMA_VERSION)).toBe(45)
    expect(resolveOrchestrationMigrationStartVersion(db, 44, 43)).toBe(44)
    expect(axiomSchema(db)).toBe(before)
    expect(db.prepare('SELECT id FROM missions').all()).toEqual([{ id: 'future' }])
    // The completeness probe must also ignore absent Axiom tables at a current-version stamp.
    dropAxiomSchema(db)
    expect(resolveOrchestrationMigrationStartVersion(db, 43, SCHEMA_VERSION)).toBe(43)
  })

  it('delete triggers remove both task edge directions, retain audit history, and clean every Mission table on run deletion', () => {
    const { db } = open()
    seedMission(db, 'removed')
    seedMission(db, 'retained')
    db.exec(`INSERT INTO mission_task_edges (mission_id, from_task_id, to_task_id, plan_revision_id)
      VALUES ('removed', 'removed-previous', 'removed', 'removed')`)
    db.exec("DELETE FROM tasks WHERE id = 'removed'")
    for (const table of ['task_stages', 'mission_task_edges', 'attempt_bindings']) {
      expect(
        db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE mission_id = ?`).get('removed'),
        table
      ).toEqual({ count: 0 })
    }
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE mission_id = 'removed'").get()
    ).toEqual({ count: 1 })
    // All other evidence remains addressable by mission_id after the Task has disappeared.
    for (const table of Object.keys(TABLE_COLUMNS).filter(
      (name) =>
        !['missions', 'task_stages', 'mission_task_edges', 'attempt_bindings'].includes(name)
    )) {
      expect(
        db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE mission_id = ?`).get('removed'),
        table
      ).toEqual({ count: 1 })
    }
    db.exec("DELETE FROM runs WHERE id = 'run-removed'")
    for (const table of Object.keys(TABLE_COLUMNS)) {
      const key = table === 'missions' ? 'id' : 'mission_id'
      expect(
        db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${key} = ?`).get('removed'),
        table
      ).toEqual({ count: 0 })
      expect(
        db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${key} = ?`).get('retained'),
        table
      ).toEqual({ count: 1 })
    }
    // Also exercise run cleanup while stages, edges and bindings still exist.
    db.exec("DELETE FROM runs WHERE id = 'run-retained'")
    for (const table of Object.keys(TABLE_COLUMNS)) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(), table).toEqual({
        count: 0
      })
    }
    expect(db.prepare("SELECT id FROM tasks WHERE id = 'retained'").get()).toEqual({
      id: 'retained'
    })
    expect(db.prepare('SELECT id FROM dispatch_contexts ORDER BY id').all()).toEqual([
      { id: 'removed' },
      { id: 'retained' }
    ])
  })

  it('nulls a deleted dispatch binding without erasing Attempt history or another binding', () => {
    const { db } = open()
    seedMission(db, 'removed')
    seedMission(db, 'retained')
    const before = db.prepare("SELECT * FROM attempt_bindings WHERE dispatch_id = 'removed'").get()
    db.exec("DELETE FROM dispatch_contexts WHERE id = 'removed'")
    expect(db.prepare("SELECT * FROM attempt_bindings WHERE task_id = 'removed'").get()).toEqual({
      ...before,
      dispatch_id: null
    })
    expect(
      db.prepare("SELECT dispatch_id FROM attempt_bindings WHERE task_id = 'retained'").get()
    ).toEqual({ dispatch_id: 'retained' })
  })

  it('pins nested depth to one and leaves evolving status values to the write-boundary schemas', () => {
    const { db } = open()
    seedMission(db, 'policy')
    expect(
      db.prepare('SELECT nested_worker_max_depth, readiness_threshold FROM mission_policies').get()
    ).toEqual({ nested_worker_max_depth: 1, readiness_threshold: 'INTEGRATED' })
    expect(db.prepare('SELECT unverifiable_tolerance_minutes FROM mission_policies').get()).toEqual(
      { unverifiable_tolerance_minutes: 30 }
    )
    expect(() =>
      db.exec(
        "INSERT INTO mission_policies (mission_id, concurrency_limit, nested_worker_max_depth) VALUES ('invalid', 1, 2)"
      )
    ).toThrow(/CHECK constraint failed/)
    expect(() => db.exec('UPDATE mission_policies SET nested_worker_max_depth = 2')).toThrow(
      /CHECK constraint failed/
    )
    for (const table of Object.keys(TABLE_COLUMNS)) {
      for (const column of db.prepare(`PRAGMA table_info(${table})`).all()) {
        const name = String(column.name)
        if (!['status', 'stage', 'kind', 'action_kind'].includes(name)) {
          continue
        }
        expect(column.type).toBe('TEXT')
        expect(column.notnull).toBe(1)
        expect(() => db.exec(`UPDATE ${table} SET ${name} = 'FUTURE_VALUE'`)).not.toThrow()
      }
    }
    expect(db.prepare('SELECT previous_status FROM missions').get()).toEqual({
      previous_status: null
    })
    expect(db.prepare('SELECT previous_stage, attempt_count FROM task_stages').get()).toEqual({
      previous_stage: null,
      attempt_count: 0
    })
  })

  it('enforces Mission, revision, Attempt and Candidate identities while allowing unbound Attempts', () => {
    const { db } = open()
    seedMission(db, 'one')
    seedMission(db, 'two')
    for (const [table, key, value] of [
      ['missions', 'run_id', 'run-one'],
      ['missions', 'coordinator_orca_session_id', 'axiom-mission-one'],
      ['goal_revisions', 'mission_id', 'one'],
      ['plan_revisions', 'mission_id', 'one'],
      ['submissions', 'dispatch_id', 'one'],
      ['candidates', 'task_id', 'one']
    ]) {
      expect(
        () => db.prepare(`UPDATE ${table} SET ${key} = ? WHERE id = 'two'`).run(value),
        `${table}.${key}`
      ).toThrow(/UNIQUE constraint failed/)
    }
    expect(() =>
      db.exec("UPDATE attempt_bindings SET dispatch_id = 'one' WHERE task_id = 'two'")
    ).toThrow(/UNIQUE constraint failed/)
    expect(() =>
      db.exec("UPDATE attempt_bindings SET task_id = 'one' WHERE task_id = 'two'")
    ).toThrow(/UNIQUE constraint failed/)
    expect(() =>
      db.exec('INSERT INTO mission_task_edges SELECT * FROM mission_task_edges')
    ).toThrow(/UNIQUE constraint failed/)
    expect(() => db.exec('UPDATE attempt_bindings SET dispatch_id = NULL')).not.toThrow()
    expect(db.prepare('SELECT dispatch_id FROM attempt_bindings').all()).toEqual([
      { dispatch_id: null },
      { dispatch_id: null }
    ])
    expect(db.prepare('SELECT sequence FROM audit_events ORDER BY sequence').all()).toEqual([
      { sequence: 1 },
      { sequence: 2 }
    ])
    db.exec('DELETE FROM audit_events')
    db.exec(
      "INSERT INTO audit_events (mission_id, actor, object_kind, object_id, event) VALUES ('one', 'user', 'mission', 'one', 'changed')"
    )
    expect(db.prepare('SELECT sequence FROM audit_events').get()).toEqual({ sequence: 3 })
  })
})
