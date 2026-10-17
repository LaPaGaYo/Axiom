import { AXIOM_ARTIFACT_METHODS } from './axiom/artifact'
import { namespaceMethod } from '../../../axiom/namespace-rpc'
import { AXIOM_MISSION_METHODS } from './axiom/mission'
import { AXIOM_GOAL_METHODS } from './axiom/goal'
import { AXIOM_PLAN_METHODS } from './axiom/plan'
import { AXIOM_TASK_METHODS } from './axiom/task'

export const AXIOM_METHODS = [
  namespaceMethod,
  ...AXIOM_MISSION_METHODS,
  ...AXIOM_GOAL_METHODS,
  ...AXIOM_PLAN_METHODS,
  ...AXIOM_TASK_METHODS,
  ...AXIOM_ARTIFACT_METHODS
]
