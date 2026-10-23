import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatOrcaSessionAddress, isOrcaSessionId } from '../../../shared/orca-session-address'
import { testOrcaSessionId } from '../../../shared/orca-session-address-test-fixture'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { runLifecycleWriteTransaction } from '../../runtime/orchestration/db/lifecycle-write-transaction-runner'
import {
  hasRunBindingKey,
  mailboxAddressOf,
  runBoundToCoordinator,
  runCoordinatorKey,
  type OrchestrationSessionCaller
} from '../../runtime/orchestration/orchestration-caller-identity'
import {
  resolveDeclaredCallerParty,
  resolveOrcaSessionParty
} from '../../runtime/orchestration/orchestration-party'

describe('D14 synthetic Mission session party', () => {
  let db: OrchestrationDb
  let directory: string | undefined
  const sessionId = testOrcaSessionId(`axiom-mission-${randomUUID()}`)
  const caller: OrchestrationSessionCaller = {
    address: formatOrcaSessionAddress(sessionId),
    terminalHandle: null,
    paneKey: null,
    orcaSessionId: sessionId,
    sessionId,
    workspaceId: 'repo::mission'
  }

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
      directory = undefined
    }
  })

  function createMissionRun(id = sessionId) {
    return db.createRun({
      objective: 'Mission kernel contract',
      coordinatorHandle: null,
      coordinatorPaneKey: null,
      coordinatorOrcaSessionId: id
    })
  }

  it('rolls a nested createRun and its coordinator binding back with the outer transaction', () => {
    const original = createMissionRun()
    let replacementId = ''
    expect(() =>
      runLifecycleWriteTransaction(db.db, 'axiom_create_mission', () => {
        const replacement = createMissionRun()
        replacementId = replacement.id
        expect(db.getRun(replacementId)).toEqual(replacement)
        throw new Error('mission insert failed')
      })
    ).toThrow('mission insert failed')
    expect(replacementId).not.toBe('')
    expect(db.getRun(replacementId)).toBeUndefined()
    expect(db.getRun(original.id)).toEqual(original)
    expect(db.getCurrentRunForCoordinator(caller)?.id).toBe(original.id)
    expect(db.getRunMailboxOwnerIdsForHandle(caller.address)).toEqual([original.id])
  })

  it('constructs a bound in-process caller without an agent-session record', () => {
    expect(isOrcaSessionId(sessionId)).toBe(true)
    expect(resolveOrcaSessionParty(sessionId, db)).toEqual({
      address: caller.address,
      terminalHandle: null,
      paneKey: null,
      orcaSessionId: sessionId
    })
    const run = createMissionRun()
    expect(run).toMatchObject({
      coordinator_handle: null,
      coordinator_pane_key: null,
      coordinator_orca_session_id: sessionId
    })
    expect(hasRunBindingKey(caller)).toBe(true)
    expect(mailboxAddressOf(caller)).toBe(formatOrcaSessionAddress(sessionId))
    expect(runBoundToCoordinator(run, caller)).toBe(true)
    expect(runCoordinatorKey(run)).toEqual({
      terminalHandle: null,
      paneKey: null,
      orcaSessionId: sessionId
    })
    expect(db.getCurrentRunForCoordinator(caller)?.id).toBe(run.id)
    expect(() => resolveDeclaredCallerParty(caller.address, db)).toThrow(
      'a chat is identified only by the Axiom session ID its own environment sends'
    )
  })

  it('isolates Mission ids and fences the old consumer when an id is reused', () => {
    const first = createMissionRun()
    const secondId = testOrcaSessionId(`axiom-mission-${randomUUID()}`)
    const second = createMissionRun(secondId)
    expect(db.getRun(first.id)).toEqual(first)
    expect(
      runBoundToCoordinator(db.requireCurrentConsumer(first.id, first.consumer_generation), caller)
    ).toBe(true)

    const replacement = createMissionRun()
    expect(db.getRunRaw(first.id)).toMatchObject({
      coordinator_handle: null,
      coordinator_pane_key: null,
      coordinator_orca_session_id: null,
      consumer_generation: first.consumer_generation + 1
    })
    expect(
      runBoundToCoordinator(
        db.requireCurrentConsumer(first.id, first.consumer_generation + 1),
        caller
      )
    ).toBe(false)
    expect(db.getCurrentRunForCoordinator(caller)?.id).toBe(replacement.id)
    expect(db.getRun(second.id)).toEqual(second)
    expect(() => db.requireCurrentConsumer(first.id, first.consumer_generation)).toThrowError(
      expect.objectContaining({ code: 'consumer_fenced' })
    )
  })

  it('recovers the same Run binding and caller from a reopened file database', () => {
    directory = mkdtempSync(join(tmpdir(), 'axiom-session-party-'))
    const path = join(directory, 'orchestration.db')
    db.close()
    db = new OrchestrationDb(path)
    const run = createMissionRun()
    db.close()
    db = new OrchestrationDb(path)

    const recovered = db.getRun(run.id)
    expect(recovered).toEqual(run)
    if (!recovered) {
      throw new Error('Expected the persisted Run')
    }
    expect(runBoundToCoordinator(recovered, caller)).toBe(true)
    expect(db.getCurrentRunForCoordinator(caller)?.id).toBe(run.id)
    expect(resolveOrcaSessionParty(sessionId, db).address).toBe(caller.address)
    expect(db.getRunMailboxOwnerIdsForHandle(caller.address)).toEqual([run.id])
    expect(db.requireCurrentConsumer(run.id, run.consumer_generation)).toMatchObject({
      id: run.id,
      consumer_generation: run.consumer_generation
    })
  })
})
