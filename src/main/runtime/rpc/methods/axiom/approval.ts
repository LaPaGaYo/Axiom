import { defineMethod } from '../../core'
import {
  ApprovalGrantParams,
  ApprovalDenyParams
} from '../../../../../shared/axiom-contract/approval-params'
import { getAxiomControlPlane, missionSummary } from '../../../../axiom/control-plane'

export const AXIOM_APPROVAL_METHODS = [
  defineMethod({
    name: 'axiom.approval.grant',
    permission: 'workspace',
    params: ApprovalGrantParams,
    handler: (p, ctx) => {
      const { missions, store } = getAxiomControlPlane(ctx.runtime)
      const approval = missions.grantApproval({ ...p, via: ctx.caller?.kind ?? 'unknown' })
      return { mission: missionSummary(missions.getMission(approval.missionId), store), approval }
    }
  }),
  defineMethod({
    name: 'axiom.approval.deny',
    permission: 'workspace',
    params: ApprovalDenyParams,
    handler: (p, ctx) => {
      const { missions, store } = getAxiomControlPlane(ctx.runtime)
      const approval = missions.denyApproval({ ...p, via: ctx.caller?.kind ?? 'unknown' })
      return { mission: missionSummary(missions.getMission(approval.missionId), store), approval }
    }
  })
]
