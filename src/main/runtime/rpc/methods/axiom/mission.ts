import { ensureIntegrationBase } from '../../../../axiom/execution/integration-base'
import { defineMethod } from '../../core'
import {
  MissionCreateParams,
  MissionShowParams,
  MissionListParams,
  MissionStartParams,
  MissionPauseParams,
  MissionResumeParams,
  MissionCancelParams
} from '../../../../../shared/axiom-contract/mission-params'
import { getAxiomControlPlane, missionSummary } from '../../../../axiom/control-plane'

export const AXIOM_MISSION_METHODS = [
  defineMethod({
    name: 'axiom.mission.create',
    params: MissionCreateParams,
    handler: async (p, { runtime }) => {
      const repo = await runtime.showRepo(p.repo)
      const result = getAxiomControlPlane(runtime).missions.createMission({
        repoId: repo.id,
        repoPath: repo.path,
        targetBranch: p.targetBranch,
        goal: p.goal,
        policy: p.policy,
        provenance: p.goal.provenance
      })
      return { ...result, mission: missionSummary(result.mission) }
    }
  }),
  defineMethod({
    name: 'axiom.mission.show',
    params: MissionShowParams,
    handler: (p, { runtime }) => ({
      mission: missionSummary(getAxiomControlPlane(runtime).missions.getMission(p.missionId))
    })
  }),
  defineMethod({
    name: 'axiom.mission.list',
    params: MissionListParams,
    handler: async (p, { runtime }) => {
      const repo = p.repo === undefined ? undefined : await runtime.showRepo(p.repo)
      return {
        missions: getAxiomControlPlane(runtime)
          .missions.listMissions({
            repoId: repo?.id,
            status: p.status,
            cursor: p.cursor
          })
          .map(missionSummary)
      }
    }
  }),
  defineMethod({
    name: 'axiom.mission.start',
    params: MissionStartParams,
    handler: async (p, { runtime }) => {
      const { missions, store } = getAxiomControlPlane(runtime)
      const mission = missions.getMission(p.missionId)
      const base = await ensureIntegrationBase({
        repoPath: mission.repoPath,
        targetBranch: mission.targetBranch,
        missionId: mission.id
      })
      store.appendAuditEvent({
        missionId: mission.id,
        actor: 'MissionController',
        objectKind: 'mission',
        objectId: mission.id,
        event: base.created ? 'integration.base_created' : 'integration.base_reused',
        before: null,
        after: { sha: base.sha }
      })
      return { mission: missionSummary(missions.startExecution(p.missionId)) }
    }
  }),
  defineMethod({
    name: 'axiom.mission.pause',
    params: MissionPauseParams,
    handler: (p, { runtime }) => ({
      mission: missionSummary(
        getAxiomControlPlane(runtime).missions.pauseMission(p.missionId, p.reason)
      )
    })
  }),
  defineMethod({
    name: 'axiom.mission.resume',
    params: MissionResumeParams,
    handler: (p, { runtime }) => ({
      mission: missionSummary(
        getAxiomControlPlane(runtime).missions.resumeMission(p.missionId, p.reason)
      )
    })
  }),
  defineMethod({
    name: 'axiom.mission.cancel',
    params: MissionCancelParams,
    handler: (p, { runtime }) => ({
      mission: missionSummary(
        getAxiomControlPlane(runtime).missions.cancelMission(p.missionId, p.reason)
      )
    })
  })
]
