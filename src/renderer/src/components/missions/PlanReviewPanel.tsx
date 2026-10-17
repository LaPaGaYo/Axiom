import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { PlanRevision } from '../../../../shared/axiom-contract/mission-objects'

export function PlanReviewPanel({
  plan,
  busy,
  onApprove,
  onReject
}: {
  plan: PlanRevision
  busy: boolean
  onApprove: () => void
  onReject: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const proposed = plan.status === 'PROPOSED'
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
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        {plan.tasks.map((task) => (
          <li key={task.id}>
            <span className="font-medium">
              {task.id} · {task.title}
            </span>
            <p>{task.objective}</p>
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              {task.acceptanceCriteria.map((criterion, i) => (
                <li key={`${i}:${criterion}`}>{criterion}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
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
      {plan.rejectedReason && <p className="text-sm">{plan.rejectedReason}</p>}
      {proposed && (
        <>
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
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={onApprove}>
              {translate('missions.approvePlan', 'Approve plan')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || !reason.trim()}
              onClick={() => onReject(reason.trim())}
            >
              {translate('missions.rejectPlan', 'Reject plan')}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
