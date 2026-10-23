import { ensureIntegrationBase } from '../../../../axiom/execution/integration-base'
import { defineMethod } from '../../core'
import {
  MissionCreateParams,
  MissionShowParams,
  MissionListParams,
  MissionStartParams,
  MissionPlanParams,
  MissionPauseParams,
  MissionResumeParams,
  MissionCancelParams
} from '../../../../../shared/axiom-contract/mission-params'
import { getAxiomControlPlane, missionSummary } from '../../../../axiom/control-plane'

export const AXIOM_MISSION_METHODS = [
  defineMethod({
    name: 'axiom.mission.plan',
    permission: 'workspace',
    params: MissionPlanParams,
    handler: (p, { runtime }) => getAxiomControlPlane(runtime).planner.start(p.missionId)
  }),
  defineMethod({
    name: 'axiom.mission.create',
    permission: 'workspace',
    params: MissionCreateParams,
    handler: async (p, { runtime }) => {
      const repo = await runtime.showRepo(p.repo)
      const { missions, store } = getAxiomControlPlane(runtime)
      const result = missions.createMission({
        repoId: repo.id,
        repoPath: repo.path,
        targetBranch: p.targetBranch,
        goal: p.goal,
        policy: p.policy,
        provenance: p.goal.provenance
      })
      return { ...result, mission: missionSummary(result.mission, store) }
    }
  }),
  defineMethod({
    name: 'axiom.mission.show',
    permission: 'workspace',
    params: MissionShowParams,
    handler: (p, { runtime }) => {
      const { missions, store } = getAxiomControlPlane(runtime)
      return { mission: missionSummary(missions.getMission(p.missionId), store) }
    }
  }),
  defineMethod({
    name: 'axiom.mission.list',
    permission: 'workspace',
    params: MissionListParams,
    handler: async (p, { runtime }) => {
      const repo = p.repo === undefined ? undefined : await runtime.showRepo(p.repo)
      const { missions, store } = getAxiomControlPlane(runtime)
      return {
        missions: missions
          .listMissions({
            repoId: repo?.id,
            status: p.status,
            cursor: p.cursor
          })
          .map((mission) => missionSummary(mission, store))
      }
    }
  }),
  defineMethod({
    name: 'axiom.mission.start',
    permission: 'workspace',
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
      return { mission: missionSummary(missions.startExecution(p.missionId), store) }
    }
  }),
  defineMethod({
    name: 'axiom.mission.pause',
    permission: 'workspace',
    params: MissionPauseParams,
    handler: (p, { runtime }) => {
      const { missions, store } = getAxiomControlPlane(runtime)
      return { mission: missionSummary(missions.pauseMission(p.missionId, p.reason), store) }
    }
  }),
  defineMethod({
    name: 'axiom.mission.resume',
    permission: 'workspace',
    params: MissionResumeParams,
    handler: (p, { runtime }) => {
      const { missions, store } = getAxiomControlPlane(runtime)
      return { mission: missionSummary(missions.resumeMission(p.missionId, p.reason), store) }
    }
  }),
  defineMethod({
    name: 'axiom.mission.cancel',
    permission: 'workspace',
    params: MissionCancelParams,
    handler: async (p, { runtime }) => {
      const plane = getAxiomControlPlane(runtime)
      const mission = plane.missions.cancelMission(p.missionId, p.reason)
      const { attempts } = await plane.recovery.reconcileAttempts({ missionId: p.missionId })
      return { mission: missionSummary(mission, plane.store), attempts }
    }
  })
]
