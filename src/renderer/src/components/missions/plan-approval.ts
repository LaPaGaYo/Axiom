import { translate } from '@/i18n/i18n'
import type { PlanRevision } from '../../../../shared/axiom-contract/mission-objects'

export function planApprovalDescription(plan: PlanRevision) {
  const consequence = translate(
    'missions.planApproveConsequence',
    "Approving creates this plan's {{count}} Task(s). Nothing runs until the Mission is started. An approved plan cannot be replaced by another one yet; from then on only single Tasks can be changed, where the Control Plane offers it, or the Mission canceled.",
    { count: plan.tasks.length }
  )
  return plan.warnings.length
    ? `${consequence} ${translate('missions.planApproveWarnings', 'This revision has {{count}} warning(s).', { count: plan.warnings.length })}`
    : consequence
}
