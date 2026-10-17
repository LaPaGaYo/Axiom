import { z } from 'zod'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { runLifecycleWriteTransaction } from '../../runtime/orchestration/db/lifecycle-write-transaction-runner'
import { missionsStore } from './missions-store'
import { revisionsStore } from './revisions-store'
import { taskGraphStore } from './task-graph-store'
import { artifactsStore } from './artifacts-store'
import { policyAuditStore } from './policy-audit-store'

type Missions = ReturnType<typeof missionsStore>
type Revisions = ReturnType<typeof revisionsStore>
type TaskGraph = ReturnType<typeof taskGraphStore>
type Artifacts = ReturnType<typeof artifactsStore>
type PolicyAudit = ReturnType<typeof policyAuditStore>

// One injected store; table modules keep SQL and validation within the file-size gate.
export class AxiomStore {
  readonly updateRunObjective: Missions['updateRunObjective']
  readonly insertMission: Missions['insertMission']
  readonly getMission: Missions['getMission']
  readonly getMissionByRunId: Missions['getMissionByRunId']
  readonly getMissionBySessionId: Missions['getMissionBySessionId']
  readonly listMissions: Missions['listMissions']
  readonly updateMissionStatus: Missions['updateMissionStatus']
  readonly setActiveRevisions: Missions['setActiveRevisions']
  readonly insertGoalRevision: Revisions['insertGoalRevision']
  readonly getGoalRevision: Revisions['getGoalRevision']
  readonly listGoalRevisions: Revisions['listGoalRevisions']
  readonly updateGoalRevisionStatus: Revisions['updateGoalRevisionStatus']
  readonly insertPlanRevision: Revisions['insertPlanRevision']
  readonly getPlanRevision: Revisions['getPlanRevision']
  readonly listPlanRevisions: Revisions['listPlanRevisions']
  readonly updatePlanRevisionStatus: Revisions['updatePlanRevisionStatus']
  readonly insertTaskStage: TaskGraph['insertTaskStage']
  readonly getTaskStage: TaskGraph['getTaskStage']
  readonly listTaskStages: TaskGraph['listTaskStages']
  readonly updateTaskStage: TaskGraph['updateTaskStage']
  readonly countTaskStages: TaskGraph['countTaskStages']
  readonly insertTaskEdges: TaskGraph['insertTaskEdges']
  readonly listTaskEdges: TaskGraph['listTaskEdges']
  readonly listUpstreamEdges: TaskGraph['listUpstreamEdges']
  readonly listDownstreamEdges: TaskGraph['listDownstreamEdges']
  readonly upsertPolicy: PolicyAudit['upsertPolicy']
  readonly getPolicy: PolicyAudit['getPolicy']
  readonly appendAuditEvent: PolicyAudit['appendAuditEvent']
  readonly listAuditEvents: PolicyAudit['listAuditEvents']

  readonly insertArtifact: Artifacts['insertArtifact']
  readonly getArtifact: Artifacts['getArtifact']
  readonly listArtifacts: Artifacts['listArtifacts']
  readonly insertContextPackage: Artifacts['insertContextPackage']
  readonly getContextPackage: Artifacts['getContextPackage']
  readonly listDecisions: Artifacts['listDecisions']
  readonly getContextTokenBudget: Artifacts['getContextTokenBudget']

  constructor(private readonly db: OrchestrationDb) {
    const artifacts = artifactsStore(db)
    this.insertArtifact = artifacts.insertArtifact
    this.getArtifact = artifacts.getArtifact
    this.listArtifacts = artifacts.listArtifacts
    this.insertContextPackage = artifacts.insertContextPackage
    this.getContextPackage = artifacts.getContextPackage
    this.listDecisions = artifacts.listDecisions
    this.getContextTokenBudget = artifacts.getContextTokenBudget
    const missions = missionsStore(db)
    this.updateRunObjective = missions.updateRunObjective
    this.insertMission = missions.insertMission
    this.getMission = missions.getMission
    this.getMissionByRunId = missions.getMissionByRunId
    this.getMissionBySessionId = missions.getMissionBySessionId
    this.listMissions = missions.listMissions
    this.updateMissionStatus = missions.updateMissionStatus
    this.setActiveRevisions = missions.setActiveRevisions
    const revisions = revisionsStore(db)
    this.insertGoalRevision = revisions.insertGoalRevision
    this.getGoalRevision = revisions.getGoalRevision
    this.listGoalRevisions = revisions.listGoalRevisions
    this.updateGoalRevisionStatus = revisions.updateGoalRevisionStatus
    this.insertPlanRevision = revisions.insertPlanRevision
    this.getPlanRevision = revisions.getPlanRevision
    this.listPlanRevisions = revisions.listPlanRevisions
    this.updatePlanRevisionStatus = revisions.updatePlanRevisionStatus
    const graph = taskGraphStore(db)
    this.insertTaskStage = graph.insertTaskStage
    this.getTaskStage = graph.getTaskStage
    this.listTaskStages = graph.listTaskStages
    this.updateTaskStage = graph.updateTaskStage
    this.countTaskStages = graph.countTaskStages
    this.insertTaskEdges = graph.insertTaskEdges
    this.listTaskEdges = graph.listTaskEdges
    this.listUpstreamEdges = graph.listUpstreamEdges
    this.listDownstreamEdges = graph.listDownstreamEdges
    const policyAudit = policyAuditStore(db)
    this.upsertPolicy = policyAudit.upsertPolicy
    this.getPolicy = policyAudit.getPolicy
    this.appendAuditEvent = policyAudit.appendAuditEvent
    this.listAuditEvents = policyAudit.listAuditEvents
  }

  transaction<T>(savepoint: string, operation: () => T): T {
    const suffix = z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .parse(savepoint)
    return runLifecycleWriteTransaction(this.db.db, `axiom_${suffix}`, operation)
  }
}
