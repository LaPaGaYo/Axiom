import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { testOrcaSessionId } from '../../../shared/orca-session-address-test-fixture'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { createRootDispatch } from '../../runtime/orchestration/db/root-dispatch-test-fixture'

describe('D10 Mission Task creation', () => {
  let db: OrchestrationDb
  let runId: string

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    runId = db.createRun({
      objective: 'Mission task contract',
      coordinatorHandle: null,
      coordinatorPaneKey: null,
      coordinatorOrcaSessionId: testOrcaSessionId('axiom-mission-task-contract')
    }).id
  })

  afterEach(() => db.close())

  it('creates an immediately ready Task with empty deps and no terminal lineage', () => {
    const task = db.createTask({ spec: 'Materialize approved plan', deps: [], runId })
    expect(task).toMatchObject({
      status: 'ready',
      run_id: runId,
      deps: '[]',
      created_by_terminal_handle: null,
      created_by_pane_key: null,
      created_by_process_incarnation: null,
      created_by_run_generation: null
    })
  })

  it('leaves an empty-deps peer untouched after legal completion and promotion', () => {
    const first = db.createTask({ spec: 'First Attempt', deps: [], runId })
    const peer = db.createTask({ spec: 'Independent Task', deps: [], runId })
    const dispatch = createRootDispatch(db, first.id, 'term_worker')
    expect(db.getTask(first.id)?.status).toBe('dispatched')
    expect(db.updateTaskStatus(first.id, 'completed', 'Attempt settled')).toMatchObject({
      status: 'completed'
    })
    expect(db.getDispatchContextById(dispatch.id)?.status).toBe('completed')
    expect(db.getTask(peer.id)).toEqual(peer)
    db.promoteReadyTasks(first.id)
    expect(db.getTask(peer.id)).toEqual(peer)
  })

  it('makes non-empty deps pending and promotes them on Orca completion', () => {
    const first = db.createTask({ spec: 'Dependency', deps: [], runId })
    const dependent = db.createTask({
      spec: 'Must be rejected by admission',
      deps: [first.id],
      runId
    })
    expect(dependent).toMatchObject({ status: 'pending', run_id: runId })
    db.updateTaskStatus(first.id, 'completed')
    expect(db.getTask(dependent.id)?.status).toBe('ready')
  })
})
