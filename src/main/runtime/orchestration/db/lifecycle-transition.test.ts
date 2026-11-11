import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { runLifecycleWriteTransaction } from './lifecycle-write-transaction-runner'

describe('guarded lifecycle transitions', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => db?.close())

  it('keeps temp storage in memory', () => {
    db = new OrchestrationDb(':memory:')
    expect(db.db.pragma('temp_store', { simple: true })).toBe(2)
  })

  it.each([
    ['reports the failure when SQLite already ended the transaction', false],
    ['reports the failure when SQLite ended the transaction inside a savepoint', true]
  ] as const)('%s', (_title, nested) => {
    const database = (db = new OrchestrationDb(':memory:'))
    const task = database.createTask({ runId: 'run_legacy_local', spec: 'aborted transaction' })
    const before = database.getTask(task.id)
    // Disk-full and I/O errors can make SQLite roll back the whole transaction itself.
    database.db.exec(`CREATE TEMP TRIGGER abort_task_update BEFORE UPDATE ON tasks
      BEGIN SELECT RAISE(ROLLBACK, 'database or disk is full'); END`)
    if (nested) {
      database.db.exec('BEGIN')
    }

    expect(() =>
      runLifecycleWriteTransaction(database.db, 'aborted_test', () =>
        database.transitionLifecycle({
          entity: 'task',
          id: task.id,
          from: 'ready',
          to: 'completed'
        })
      )
    ).toThrow('database or disk is full')
    expect(database.db.isTransaction).toBe(false)
    expect(database.getTask(task.id)).toEqual(before)
  })

  it('rejects a stale prior state without changing the projection', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ runId: 'run_legacy_local', spec: 'guarded transition' })

    expect(() =>
      db!.transitionLifecycle({
        entity: 'task',
        id: task.id,
        from: 'pending',
        to: 'completed'
      })
    ).toThrow(/expected pending/)
    expect(db.getTask(task.id)?.status).toBe('ready')
  })

  it('composes its projection into the caller-owned transaction', () => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ runId: 'run_legacy_local', spec: 'caller-owned rollback' })

    db.db.exec('SAVEPOINT lifecycle_test')
    expect(
      db.transitionLifecycle({
        entity: 'task',
        id: task.id,
        from: 'ready',
        to: 'completed',
        projection: { result: 'uncommitted' }
      })
    ).toEqual({ changed: true })
    expect(db.getTask(task.id)?.status).toBe('completed')
    db.db.exec('ROLLBACK TO lifecycle_test')
    db.db.exec('RELEASE lifecycle_test')

    expect(db.getTask(task.id)).toMatchObject({ status: 'ready', result: null })
  })

  it.each([
    ['ready', 'pending'],
    ['blocked', 'completed'],
    ['failed', 'completed'],
    ['completed', 'blocked']
  ] as const)('preserves public task updates from %s to %s', (from, to) => {
    db = new OrchestrationDb(':memory:')
    const task = db.createTask({ runId: 'run_legacy_local', spec: 'manual status correction' })
    db.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(from, task.id)

    expect(db.updateTaskStatus(task.id, to)?.status).toBe(to)
  })
})
