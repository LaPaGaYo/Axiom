import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type {
  GoalRevision,
  PlanRevision,
  Policy
} from '../../../../shared/axiom-contract/mission-objects'
import type { MissionPendingItem } from '../../../../shared/axiom-contract/mission-pending'
import { VerificationRulesSchema } from '../../../../shared/axiom-contract/verification-rules'
import { PlanTaskDetails } from './PlanTaskDetails'
import { PlanReviewSections } from './PlanReviewSections'
import { PlanReviewGroup } from './PlanReviewGroup'
import { PlanRevisionChanges } from './PlanRevisionChanges'
import { previousRejectedPlan } from './plan-revision-diff'

const emptyRevisions: PlanRevision[] = []
const emptyPendingItems: MissionPendingItem[] = []

export function PlanReviewPanel({
  plan,
  goal,
  policy,
  revisions = emptyRevisions,
  pendingItems = emptyPendingItems,
  pendingError = false,
  busy,
  onApprove,
  onReject
}: {
  plan: PlanRevision
  goal?: GoalRevision | null
  policy?: Policy | null
  revisions?: PlanRevision[]
  pendingItems?: MissionPendingItem[]
  pendingError?: boolean
  busy: boolean
  onApprove: () => void
  onReject: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const proposed = plan.status === 'PROPOSED'
  const rules = policy ? VerificationRulesSchema.safeParse(policy.verificationRules) : null
  const previous = proposed ? previousRejectedPlan(plan, revisions) : undefined
  const actions = pendingError
    ? []
    : pendingItems
        .filter((item) => item.kind === 'plan_review' && item.objectId === plan.id)
        .flatMap((item) => item.actions)
  const canApprove = actions.includes('axiom.plan.approve')
  const canReject = actions.includes('axiom.plan.reject')
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4 text-card-foreground"
      aria-label={translate('missions.planReview', 'Plan review')}
    >
      <h2 className="text-sm font-semibold">
        {translate('missions.planRevision', 'Plan revision {{revision}}', {
          revision: plan.revision
        })}{' '}
        · {plan.status}
      </h2>
      <p className="text-xs text-muted-foreground">
        {plan.id} · {plan.provenance.actor}
      </p>
      {plan.risks.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-medium">{translate('missions.risks', 'Risks')}</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {plan.risks.map((risk) => (
              <li key={risk.id}>
                {risk.description}
                {risk.mitigation && <> — {risk.mitigation}</>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <PlanReviewSections plan={plan} goal={goal} />
      <PlanReviewGroup title={translate('missions.tasks', 'Tasks')}>
        {proposed && (
          <p className="text-xs text-muted-foreground">
            {translate(
              'missions.planPolicyTiming',
              "These commands follow the Mission's policy as it is now. Verification reads the policy when it runs, so a later policy change changes them."
            )}
          </p>
        )}
        {plan.status === 'APPROVED' && (
          <p className="text-xs text-muted-foreground">
            {translate(
              'missions.planAdjustedSince',
              "Tasks can be adjusted after a plan is approved. A Task's own page shows its acceptance criteria as they are now."
            )}
          </p>
        )}
        <ol className="space-y-4 text-sm">
          {plan.tasks.map((task) => (
            <PlanTaskDetails
              key={task.id}
              task={task}
              plan={plan}
              rules={rules?.success ? rules.data : null}
              policyUnavailable={!policy}
            />
          ))}
        </ol>
      </PlanReviewGroup>
      <div className="space-y-1">
        <h3 className="text-xs font-medium">
          {translate('missions.dependencies', 'Dependencies')}
        </h3>
        {plan.edges.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {translate('missions.noEdges', 'No dependency edges.')}
          </p>
        ) : (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {plan.edges.map((edge) => (
              <li key={`${edge.fromTaskId}:${edge.toTaskId}`}>
                {edge.fromTaskId} → {edge.toTaskId} · {edge.readinessThreshold}
              </li>
            ))}
          </ul>
        )}
      </div>
      {plan.status === 'REJECTED' && (
        <PlanReviewGroup title={translate('missions.planRejectedBecause', 'Rejected because')}>
          <p className="whitespace-pre-wrap break-words text-sm">{plan.rejectedReason}</p>
        </PlanReviewGroup>
      )}
      {previous && <PlanRevisionChanges plan={plan} previous={previous} />}
      {proposed && (
        <>
          {canReject && (
            <div className="space-y-2">
              <Label htmlFor={`reject-${plan.id}`}>
                {translate('missions.rejectionReason', 'Reason for rejection')}
              </Label>
              <Input
                id={`reject-${plan.id}`}
                value={reason}
                disabled={busy}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          )}
          <div className="flex gap-2">
            {canApprove && (
              <Button size="sm" disabled={busy} onClick={onApprove}>
                {translate('missions.approvePlan', 'Approve plan')}
              </Button>
            )}
            {canReject && (
              <Button
                size="sm"
                variant="destructive"
                disabled={busy || !reason.trim()}
                onClick={() => onReject(reason.trim())}
              >
                {translate('missions.rejectPlan', 'Reject plan')}
              </Button>
            )}
          </div>
          {!canApprove && !canReject && (
            <p className="text-xs text-muted-foreground">
              {pendingError
                ? translate(
                    'missions.planActionsReadError',
                    'What can be done with this plan could not be read. Refresh to try again.'
                  )
                : translate(
                    'missions.planActionsUnavailable',
                    'This plan cannot be approved or rejected right now.'
                  )}
            </p>
          )}
        </>
      )}
    </section>
  )
}
