import { writeFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getAxiomControlPlane } from '../control-plane'
import { pendingFixture, type PendingFixture } from './pending-fixture.test-support'
import {
  approval,
  databaseSnapshot,
  tokenBudget,
  verification
} from './pending-evidence.test-support'

let f: PendingFixture
beforeEach(() => {
  f = pendingFixture()
})
afterEach(async () => {
  await f.close()
  vi.restoreAllMocks()
})

it('measures and preserves real read model evidence for the twelve Task fixture', async () => {
  f.stage('T01', 'RUNNING')
  f.message('T01')
  tokenBudget(f, 'T02')
  f.stage('T02', 'BLOCKED', 'token_budget_exhausted')
  verification(f, 'T03', 'HUMAN_REVIEW')
  f.stage('T05', 'BLOCKED', 'scope')
  f.stage('T06', 'SUBMITTED')
  f.message('T06')
  f.stage('T07', 'VERIFIED')
  f.stage('T12', 'RUNNING')
  getAxiomControlPlane(f.runtime)
  const before = databaseSnapshot(f)
  const queries = vi.spyOn(f.db.db, 'prepare')
  const listStartedAt = performance.now()
  const tasks = await f.list()
  const listElapsedMs = performance.now() - listStartedAt
  const listQueries = queries.mock.calls.length
  queries.mockClear()
  const pendingStartedAt = performance.now()
  const pending = await f.pending()
  const pendingElapsedMs = performance.now() - pendingStartedAt
  const pendingQueries = queries.mock.calls.length
  queries.mockRestore()
  expect(tasks).toHaveLength(12)
  expect(pending.items.length).toBeGreaterThan(0)
  expect(listQueries).toBeGreaterThan(0)
  expect(pendingQueries).toBeGreaterThan(0)
  expect(databaseSnapshot(f)).toEqual(before)
  const examples = new Map(tasks.map((task) => [task.waitingOn.on, task]))
  await f.close()
  f = pendingFixture()
  examples.set('admission', await f.show('T01'))
  f.stage('T02', 'CANCELED')
  examples.set('none', await f.show('T02'))
  f.status('PAUSED')
  examples.set('mission', await f.show('T01'))
  f.status('EXECUTING')
  approval(f)
  examples.set('approval', await f.show('T01'))
  expect(examples.size).toBe(11)
  const evidence = {
    runtime: process.versions.bun ? 'bun' : 'node',
    version: process.versions.bun ?? process.versions.node,
    taskCount: tasks.length,
    taskList: { prepareCalls: listQueries, elapsedMs: listElapsedMs, response: { tasks } },
    missionPending: {
      prepareCalls: pendingQueries,
      elapsedMs: pendingElapsedMs,
      response: pending
    },
    waitingExamples: Object.fromEntries(examples)
  }
  const outputPath = process.env.M3_09_1_EVIDENCE_PATH
  if (outputPath) {
    writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`)
  }
})
