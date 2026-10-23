import { defineMethod } from '../../core'
import {
  GoalProposeParams,
  GoalActivateParams,
  GoalShowParams
} from '../../../../../shared/axiom-contract/goal-params'
import { getAxiomControlPlane } from '../../../../axiom/control-plane'

export const AXIOM_GOAL_METHODS = [
  defineMethod({
    name: 'axiom.goal.propose',
    permission: 'workspace',
    params: GoalProposeParams,
    handler: (p, { runtime }) => ({
      goalRevision: getAxiomControlPlane(runtime).missions.proposeGoal(p)
    })
  }),
  defineMethod({
    name: 'axiom.goal.activate',
    permission: 'workspace',
    params: GoalActivateParams,
    handler: (p, { runtime }) => ({
      goalRevision: getAxiomControlPlane(runtime).missions.activateGoal(p)
    })
  }),
  defineMethod({
    name: 'axiom.goal.show',
    permission: 'workspace',
    params: GoalShowParams,
    handler: (p, { runtime }) => ({
      goalRevision: getAxiomControlPlane(runtime).missions.getGoal(p)
    })
  })
]
