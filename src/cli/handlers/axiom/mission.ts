import { AXIOM_ARTIFACT_HANDLERS } from './artifact'
import type { CommandHandler } from '../../dispatch'
import { getRequiredStringFlag as required, getOptionalStringFlag as optional } from '../../flags'
import { DEFAULT_MISSION_POLICY } from '../../../shared/axiom-contract/mission-objects'
import { formatMission, formatMissionList, formatGoal } from '../../axiom-format'
import { readGoalFile } from './input-files'
import { callAxiom } from './rpc-command'

export const AXIOM_MISSION_HANDLERS: Record<string, CommandHandler> = {
  ...AXIOM_ARTIFACT_HANDLERS,
  'mission create': async (ctx) => {
    const params = {
      repo: required(ctx.flags, 'repo'),
      targetBranch: required(ctx.flags, 'target-branch'),
      goal: await readGoalFile(ctx.cwd, required(ctx.flags, 'goal-file')),
      policy: DEFAULT_MISSION_POLICY
    }
    await callAxiom(ctx, 'axiom.mission.create', params, formatMission)
  },
  'mission show': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.mission.show',
      { missionId: required(ctx.flags, 'mission') },
      formatMission
    )
  },
  'mission list': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.mission.list',
      {
        repo: optional(ctx.flags, 'repo'),
        status: optional(ctx.flags, 'status'),
        cursor: optional(ctx.flags, 'cursor')
      },
      formatMissionList
    )
  },
  'mission start': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.mission.start',
      { missionId: required(ctx.flags, 'mission') },
      formatMission
    )
  },
  'mission pause': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.mission.pause',
      { missionId: required(ctx.flags, 'mission'), reason: required(ctx.flags, 'reason') },
      formatMission
    )
  },
  'mission resume': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.mission.resume',
      { missionId: required(ctx.flags, 'mission'), reason: required(ctx.flags, 'reason') },
      formatMission
    )
  },
  'mission cancel': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.mission.cancel',
      { missionId: required(ctx.flags, 'mission'), reason: required(ctx.flags, 'reason') },
      formatMission
    )
  },
  'mission goal propose': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.goal.propose',
      {
        missionId: required(ctx.flags, 'mission'),
        goal: await readGoalFile(ctx.cwd, required(ctx.flags, 'goal-file'))
      },
      formatGoal
    )
  },
  'mission goal activate': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.goal.activate',
      { missionId: required(ctx.flags, 'mission'), goalRevisionId: required(ctx.flags, 'goal') },
      formatGoal
    )
  },
  'mission goal show': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.goal.show',
      { missionId: required(ctx.flags, 'mission'), goalRevisionId: required(ctx.flags, 'goal') },
      formatGoal
    )
  }
}
