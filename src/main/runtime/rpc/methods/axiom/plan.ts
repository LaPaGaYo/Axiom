import { defineMethod } from '../../core'
import {
  PlanProposeParams,
  PlanApproveParams,
  PlanRejectParams,
  PlanShowParams,
  PlanListParams
} from '../../../../../shared/axiom-contract/plan-params'
import { getAxiomControlPlane } from '../../../../axiom/control-plane'

export const AXIOM_PLAN_METHODS = [
  defineMethod({
    name: 'axiom.plan.propose',
    params: PlanProposeParams,
    handler: (p, { runtime }) => ({
      planRevision: getAxiomControlPlane(runtime).missions.proposePlan(p)
    })
  }),
  defineMethod({
    name: 'axiom.plan.approve',
    params: PlanApproveParams,
    handler: (p, { runtime }) => ({
      planRevision: getAxiomControlPlane(runtime).missions.approvePlan({
        ...p,
        provenance: { kind: 'user', actor: p.resolver, at: new Date().toISOString() }
      })
    })
  }),
  defineMethod({
    name: 'axiom.plan.reject',
    params: PlanRejectParams,
    handler: (p, { runtime }) => ({
      planRevision: getAxiomControlPlane(runtime).missions.rejectPlan(p)
    })
  }),
  defineMethod({
    name: 'axiom.plan.show',
    params: PlanShowParams,
    handler: (p, { runtime }) => ({
      planRevision: getAxiomControlPlane(runtime).missions.getPlan(p.planRevisionId)
    })
  }),
  defineMethod({
    name: 'axiom.plan.list',
    params: PlanListParams,
    handler: (p, { runtime }) => ({
      planRevisions: getAxiomControlPlane(runtime).missions.listPlans(p.missionId)
    })
  })
]
