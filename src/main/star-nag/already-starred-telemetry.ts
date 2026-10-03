import type { Store } from '../persistence'
import type { StatsCollector } from '../stats/collector'
import { track } from '../telemetry/client'
import type { StarNagPromptSource } from '../../shared/star-nag-telemetry'
import { createStarNagPromptContext } from './prompt-context'

export function trackStarNagAlreadyStarred(
  store: Store,
  stats: StatsCollector,
  source: StarNagPromptSource
): void {
  track('star_nag_outcome', {
    ...createStarNagPromptContext(store, stats, source, 'gh'),
    outcome: 'already_starred_suppressed'
  })
}
