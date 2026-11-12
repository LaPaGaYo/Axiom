import { unlinkSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { supervisionFixture } from './supervision-fixture.test-support'
import { report } from '../execution/submission-fixture.test-support'

let f: Awaited<ReturnType<typeof supervisionFixture>>
let seq: number
beforeEach(async () => {
  f = await supervisionFixture()
  f.budget()
  f.setNow(f.startedAt + 2_000_000)
  f.events(f.startedAt)
  seq = 0
})
afterEach(async () => {
  await f.cleanup()
})

function cadence(
  gap: number,
  options: { partial?: boolean; samples?: number; verified?: boolean; missionId?: string } = {}
) {
  seq++
  const missionId = options.missionId ?? f.mission.id
  const attemptId = `cadence-attempt-${seq}`
  const candidateId = `cadence-candidate-${seq}`
  f.store.insertCandidate({
    id: candidateId,
    missionId,
    taskId: f.t01.taskId,
    attemptId,
    commitSha: seq.toString(16).padStart(40, '0'),
    treeSha: 'b'.repeat(40),
    status: 'ACTIVE',
    supersededBy: null
  })
  f.store.insertSubmission({
    id: `cadence-submission-${seq}`,
    missionId,
    taskId: f.t01.taskId,
    attemptId,
    candidateId,
    report
  })
  if (options.verified !== false) {
    f.store.insertVerificationRun({
      id: `cadence-verification-${seq}`,
      missionId,
      taskId: f.t01.taskId,
      candidateId,
      status: 'PASS',
      verdictDetail: {},
      commands: [],
      toolVersions: {},
      verifier: 'fixture'
    })
  }
  f.store.appendAuditEvent({
    missionId,
    actor: 'RecoveryService',
    objectKind: 'attempt',
    objectId: attemptId,
    event: 'attempt.cadence',
    before: null,
    after: {
      taskId: f.t01.taskId,
      seq: 1,
      maxEventGapMs: gap,
      samples: options.samples ?? 2,
      resolutionMs: 60_000,
      partial: options.partial ?? false
    }
  })
}

it('derives the stall threshold from verified Attempts', async () => {
  for (const gap of [50_000, 70_000, 90_000, 180_000, 60_000]) {
    cadence(gap, { missionId: seq % 2 === 0 ? f.mission.id : 'another-mission' })
  }
  await f.tick()
  expect(f.rule('stalled')).toMatchObject([
    { after: { thresholdMs: 360_000, thresholdSource: 'measured' } }
  ])
})

it('ignores partial and unverified cadences for the threshold', async () => {
  for (let i = 0; i < 5; i++) {
    cadence(200_000)
  }
  for (let i = 0; i < 25; i++) {
    cadence(5_000_000, { partial: true })
    cadence(5_000_000, { verified: false })
    cadence(5_000_000, { samples: 1 })
  }
  await f.tick()
  expect(f.rule('stalled')).toMatchObject([
    { after: { thresholdMs: 400_000, thresholdSource: 'measured' } }
  ])
})

it('uses the default threshold until five verified Attempts exist', async () => {
  for (let i = 0; i < 4; i++) {
    cadence(200_000)
  }
  await f.tick()
  expect(f.rule('stalled')).toMatchObject([
    { after: { thresholdMs: 1_200_000, thresholdSource: 'default' } }
  ])
})

it('takes the e2e stall threshold only under the e2e config', async () => {
  vi.stubEnv('AXIOM_E2E_STALL_THRESHOLD_MS', '1000')
  f.setNow(f.startedAt + 120_000)
  await f.tick()
  expect(f.rule('stalled')).toEqual([])
  f.e2e(true)
  await f.tick()
  expect(f.rule('stalled')).toMatchObject([
    { after: { thresholdMs: 1000, thresholdSource: 'e2e' } }
  ])
})

it('uses the newest twenty qualifying cadences and the five minute floor', async () => {
  cadence(10_000_000)
  for (let i = 0; i < 20; i++) {
    cadence(60_000)
  }
  await f.tick()
  expect(f.rule('stalled')).toMatchObject([
    { after: { thresholdMs: 300_000, thresholdSource: 'measured' } }
  ])
})

it('keeps one threshold for all live headless Attempts in a pass', async () => {
  const second = f.bind('T02')
  f.db.db
    .prepare(
      'UPDATE worker_dispatches SET start_options = ?, runtime_epoch = ? WHERE dispatch_id = ?'
    )
    .run(
      JSON.stringify({ channel: 'headless', agent: 'codex' }),
      f.runtime.getRuntimeId(),
      second.attemptId
    )
  f.e2e(true)
  vi.stubEnv('AXIOM_E2E_STALL_THRESHOLD_MS', '1000')
  const append = f.store.appendAuditEvent.bind(f.store)
  vi.spyOn(f.store, 'appendAuditEvent').mockImplementation((input) => {
    const result = append(input)
    if (input.event === 'attempt.supervised') {
      vi.stubEnv('AXIOM_E2E_STALL_THRESHOLD_MS', '3000000')
    }
    return result
  })
  await f.tick()
  expect(f.rule('stalled')).toMatchObject([
    { after: { thresholdMs: 1000 } },
    { after: { thresholdMs: 1000 } }
  ])
})

it('counts an Attempt once even when it has multiple passing verification runs', async () => {
  for (let i = 0; i < 4; i++) {
    cadence(60_000)
    f.store.insertVerificationRun({
      id: `another-pass-${seq}`,
      missionId: f.mission.id,
      taskId: f.t01.taskId,
      candidateId: `cadence-candidate-${seq}`,
      status: 'PASS',
      verdictDetail: {},
      commands: [],
      toolVersions: {},
      verifier: 'fixture'
    })
  }
  await f.tick()
  expect(f.rule('stalled')).toMatchObject([{ after: { thresholdSource: 'default' } }])
})

it('reads the threshold only for an existing file and an unobserved Attempt', async () => {
  const configured = f.e2e(false)
  configured.mockClear()
  unlinkSync(f.eventsFile)
  await f.tick()
  expect(configured).not.toHaveBeenCalled()
  f.events(f.startedAt)
  await f.tick()
  expect(configured).toHaveBeenCalledOnce()
  configured.mockClear()
  await f.tick()
  expect(configured).not.toHaveBeenCalled()
})

it.each(['0', '-1', '1.5', 'NaN', '9007199254740992', ''])(
  'ignores invalid e2e threshold %s',
  async (value) => {
    vi.stubEnv('AXIOM_E2E_STALL_THRESHOLD_MS', value)
    f.e2e(true)
    await f.tick()
    expect(f.rule('stalled')).toMatchObject([
      { after: { thresholdMs: 1_200_000, thresholdSource: 'default' } }
    ])
  }
)
