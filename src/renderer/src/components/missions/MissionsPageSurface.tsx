import { Loader2, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { MissionList } from './MissionList'
import { MissionCreateDialog } from './MissionCreateDialog'
import { MissionHome } from './MissionHome'
import { PlanReviewPanel } from './PlanReviewPanel'
import { TaskStageTable } from './TaskStageTable'
import type { MissionsPageController } from './use-missions-page-controller'

export function MissionsPageSurface({ controller: c }: { controller: MissionsPageController }) {
  return (
    <main className="flex h-full min-h-0 flex-col bg-background pt-5 text-foreground md:pt-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 pb-4">
        <h1 className="text-lg font-semibold">{translate('missions.title', 'Missions')}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={c.busy} onClick={() => void c.refresh()}>
            <RefreshCw />
            {translate('missions.refresh', 'Refresh Missions')}
          </Button>
          <Button size="sm" disabled={c.busy} onClick={() => c.setCreateOpen(true)}>
            <Plus />
            {translate('missions.create', 'Create Mission')}
          </Button>
        </div>
      </header>
      {c.error && (
        <p role="alert" className="px-6 py-3 text-sm text-destructive">
          {c.error}
        </p>
      )}
      <div
        className="grid min-h-0 flex-1 grid-cols-1 overflow-auto scrollbar-sleek md:grid-cols-[16rem_minmax(0,1fr)]"
        aria-busy={c.loading}
      >
        <aside className="border-b border-border p-4 md:border-r md:border-b-0">
          <MissionList missions={c.missions} selectedId={c.selectedId} onSelect={c.select} />
        </aside>
        <div className="space-y-6 p-6">
          {c.loading && !c.detail && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {translate('missions.loading', 'Loading Missions…')}
            </p>
          )}
          {c.detail ? (
            <>
              <MissionHome
                {...c.detail}
                proposedPlans={c.detail.plans.filter((plan) => plan.status === 'PROPOSED').length}
                busy={c.busy}
                onAction={c.missionAction}
              />
              {c.detail.plans
                .filter(
                  (plan) =>
                    plan.status === 'PROPOSED' || plan.id === c.detail?.mission.activePlanRevisionId
                )
                .map((plan) => (
                  <PlanReviewPanel
                    key={plan.id}
                    plan={plan}
                    busy={
                      c.busy ||
                      !['PLAN_REVIEW', 'REPLANNING'].includes(c.detail?.mission.status ?? '')
                    }
                    onApprove={() => c.approve(plan.id)}
                    onReject={(reason) => c.reject(plan.id, reason)}
                  />
                ))}
              <TaskStageTable tasks={c.detail.tasks} />
            </>
          ) : (
            !c.loading && (
              <p className="text-sm text-muted-foreground">
                {translate('missions.select', 'Select a Mission or create one to begin.')}
              </p>
            )
          )}
        </div>
      </div>
      {c.createOpen && (
        <MissionCreateDialog
          busy={c.busy}
          error={c.error}
          onClose={() => c.setCreateOpen(false)}
          onCreate={c.create}
        />
      )}
    </main>
  )
}
