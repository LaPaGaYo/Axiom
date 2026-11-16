import { afterEach, expect, it, vi } from 'vitest'
import { ContextBuilder } from '../context-builder/context-builder'
import * as rules from '../context-builder/repository-rules'
import { AgentFactory } from '../agent-factory/agent-factory'
import { PROVIDER_SELECTION_RULES } from '../agent-factory/provider-selection'
import { RulesEngine } from '../decision-engine/rules-engine'
import { Scheduler } from '../scheduler/scheduler'
import type { IntegrationFixture } from './integration-fixture.test-support'
import { regressionFixtures } from './integration-regression-fixture.test-support'
import { verifyTask, taskBySpec, requestEvents } from './integration-admission.test-support'

const fixture = regressionFixtures()
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function schedulerFor(f: IntegrationFixture) {
  vi.spyOn(rules, 'readRepositoryRules').mockResolvedValue('Fixture rules')
  const context = new ContextBuilder(f.store, f.artifacts)
  const factory = new AgentFactory(f.store, new RulesEngine(PROVIDER_SELECTION_RULES), async () => [
    'codex',
    'claude'
  ])
  return new Scheduler(f.db, f.store, f.controller, context, factory, { effects: f.effects })
}

it('a Scheduler round requests integration before it admits work', async () => {
  const f = await fixture()
  verifyTask(f)
  const scheduler = schedulerFor(f)
  const result = await scheduler.scheduleRound(f.missionId, 'manual')
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('INTEGRATION_READY')
  expect(f.effect()).toMatchObject({ kind: 'integration.apply', status: 'pending' })
  expect(result.admitted.length).toBeGreaterThan(0)
  expect(result.admitted.every((a) => a.taskId !== f.task.taskId)).toBe(true)
  const admitted = f.audits().find((event) => event.event === 'attempt.admitted')!
  expect(requestEvents(f)[0].sequence).toBeLessThan(admitted.sequence)

  const paused = await fixture()
  verifyTask(paused)
  paused.controller.pauseMission(paused.missionId)
  await schedulerFor(paused).scheduleRound(paused.missionId, 'manual')
  expect(paused.store.getTaskStage(paused.task.taskId)?.stage).toBe('VERIFIED')
  expect(paused.effect()).toBeUndefined()
})

it('one failed request stops neither the other requests nor the round', async () => {
  const f = await fixture()
  const first = verifyTask(f)
  const second = verifyTask(f, taskBySpec(f, f.task.spec.id === 'T01' ? 'T02' : 'T01').taskId)
  const firstStages = () =>
    f.audits().filter((event) => event.objectId === first.taskId && event.event === 'task.stage')
  const before = firstStages()
  const scheduler = schedulerFor(f)
  const enqueue = f.effects.enqueue.bind(f.effects)
  let failed = false
  vi.spyOn(f.effects, 'enqueue').mockImplementation((input) => {
    if (input.kind === 'integration.apply' && !failed) {
      failed = true
      throw new Error('request unavailable')
    }
    return enqueue(input)
  })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const result = await scheduler.scheduleRound(f.missionId, 'manual')
  expect(f.store.getTaskStage(second.taskId)?.stage).toBe('INTEGRATION_READY')
  expect(result.admitted.length).toBeGreaterThan(0)
  expect(f.store.getTaskStage(first.taskId)?.stage).toBe('VERIFIED')
  expect(f.effect()).toBeUndefined()
  expect(firstStages()).toEqual(before)
  expect(requestEvents(f).map((e) => e.objectId)).toEqual([second.candidate.id])
  expect(warn).toHaveBeenCalledExactlyOnceWith('[axiom] Integration request failed', {
    missionId: f.missionId,
    taskId: first.taskId
  })
  await scheduler.scheduleRound(f.missionId, 'manual')
  expect(f.store.getTaskStage(first.taskId)?.stage).toBe('INTEGRATION_READY')
  expect(f.effect()?.status).toBe('pending')
})
