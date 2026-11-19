import { expect, it } from 'vitest'
import { ArtifactKind, AcceptanceCheckSchema } from './mission-objects'
import {
  ArtifactMetaSchema,
  ArtifactListParams,
  ArtifactPutParams,
  StoredArtifactKind
} from './artifact-params'
import { CompletionReportSchema, completionReportText } from './completion-report'
import {
  FinalizationGateSchema,
  FINALIZATION_GATE_IDS,
  MissionFinalizationSchema,
  FinalizationOutcomeSchema
} from './mission-finalization'

const gate = () => FINALIZATION_GATE_IDS.map((id) => ({ id, pass: true, evidence: [] }))
const report = () => ({
  version: 1,
  mission: { id: 'mission', repoId: 'repo', targetBranch: 'main' },
  goal: {
    id: 'goal',
    revision: 1,
    objective: 'Ship',
    constraints: [],
    criteria: [],
    revisions: []
  },
  plans: [],
  tasks: [],
  decisions: [],
  gate: gate(),
  commits: { integrationHead: 'a'.repeat(40), targetHead: 'b'.repeat(40), promoted: [] },
  risks: []
})

it('the stored artifact kind adds completion_report and a put cannot name it', () => {
  expect(StoredArtifactKind.options).toEqual([...ArtifactKind.options, 'completion_report'])
  expect(ArtifactMetaSchema.shape.kind.parse('completion_report')).toBe('completion_report')
  expect(ArtifactListParams.parse({ missionId: 'mission', kind: 'completion_report' }).kind).toBe(
    'completion_report'
  )
  expect(ArtifactPutParams.shape.kind.options).toEqual(ArtifactKind.options)
  expect(
    ArtifactPutParams.safeParse({
      missionId: 'mission',
      kind: 'completion_report',
      mediaType: 'application/json',
      related: [],
      createdBy: 'worker',
      contentBase64: ''
    }).success
  ).toBe(false)
})

it('a criterion cannot name completion_report as its artifact kind', () => {
  expect(ArtifactKind.options).toHaveLength(7)
  expect(
    AcceptanceCheckSchema.safeParse({ kind: 'artifact', artifactKind: 'completion_report' }).success
  ).toBe(false)
})

it('a completion report with an unknown key or another version does not parse', () => {
  const value = report()
  expect(CompletionReportSchema.safeParse(value).success).toBe(true)
  for (const invalid of [
    { ...value, extra: true },
    { ...value, version: 2 },
    { ...value, mission: { ...value.mission, extra: true } },
    { ...value, goal: { ...value.goal, extra: true } },
    { ...value, commits: { ...value.commits, extra: true } },
    { ...value, gate: gate().map((item) => ({ ...item, extra: true })) }
  ]) {
    expect(CompletionReportSchema.safeParse(invalid).success).toBe(false)
  }
  expect(completionReportText(value)).toBe(
    `${JSON.stringify(CompletionReportSchema.parse(value), null, 2)}\n`
  )
  expect(
    completionReportText({
      ...value,
      mission: { targetBranch: 'main', repoId: 'repo', id: 'mission' }
    })
  ).toBe(completionReportText(value))
})

it('a ready record parses with both report fields or with neither and a stopped record with neither', () => {
  const base = { targetBranch: 'main', at: '2026-11-19T12:00:00Z' }
  const pair = { reportArtifactId: 'report', reportSha256: 'c'.repeat(64) }
  const ready = { ...base, outcome: 'ready' }
  const stopped = { ...base, outcome: 'stopped', reason: 'finalization_unavailable' }
  for (const valid of [ready, { ...ready, ...pair }, stopped]) {
    expect(MissionFinalizationSchema.safeParse(valid).success).toBe(true)
    const { at: _at, ...outcome } = valid
    expect(FinalizationOutcomeSchema.safeParse(outcome).success).toBe(true)
  }
  for (const invalid of [
    { ...ready, reportArtifactId: pair.reportArtifactId },
    { ...ready, reportSha256: pair.reportSha256 },
    { ...ready, ...pair, reportSha256: 'invalid' },
    { ...stopped, ...pair },
    { ...stopped, reportArtifactId: pair.reportArtifactId },
    { ...stopped, reportSha256: pair.reportSha256 }
  ]) {
    expect(MissionFinalizationSchema.safeParse(invalid).success).toBe(false)
    const { at: _at, ...outcome } = invalid
    expect(FinalizationOutcomeSchema.safeParse(outcome).success).toBe(false)
  }
})

it('a gate parses as eight items in order or as the first seven and in no other shape', () => {
  expect(gate()).toHaveLength(8)
  expect(FinalizationGateSchema.safeParse(gate()).success).toBe(true)
  expect(FinalizationGateSchema.safeParse(gate().slice(0, 7)).success).toBe(true)
  for (const invalid of [
    gate().slice(0, 6),
    gate().slice(1),
    gate().toReversed(),
    [...gate(), gate()[0]],
    gate().map(() => gate()[0])
  ]) {
    expect(FinalizationGateSchema.safeParse(invalid).success).toBe(false)
  }
  expect(CompletionReportSchema.safeParse({ ...report(), gate: gate().slice(0, 7) }).success).toBe(
    false
  )
})
