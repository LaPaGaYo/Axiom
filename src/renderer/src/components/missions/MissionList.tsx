import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import { MISSION_STATUS_LABELS } from '../../../../shared/axiom-contract/stage-labels'
import type { MissionSummary } from '../../../../shared/axiom-contract/mission-params'

export function MissionList({
  missions,
  selectedId,
  onSelect
}: {
  missions: readonly MissionSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <nav className="space-y-2" aria-label={translate('missions.list', 'Mission list')}>
      {missions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {translate('missions.empty', 'Create a Mission to define a Goal for your repository.')}
        </p>
      )}
      {missions.map((mission) => (
        <button
          type="button"
          key={mission.id}
          className="w-full rounded-md px-3 py-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[current=true]:bg-accent"
          data-current={selectedId === mission.id}
          aria-current={selectedId === mission.id ? 'page' : undefined}
          onClick={() => onSelect(mission.id)}
        >
          <span className="min-w-0 space-y-1">
            <span className="block break-all text-sm">{mission.id}</span>
            <span className="block break-all text-xs text-muted-foreground">
              {mission.repoPath} · {mission.targetBranch}
            </span>
            <Badge variant="outline">
              {translate(
                `missions.statuses.${mission.status}`,
                MISSION_STATUS_LABELS[mission.status].en
              )}
            </Badge>
          </span>
        </button>
      ))}
    </nav>
  )
}
