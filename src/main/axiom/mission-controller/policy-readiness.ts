import type { Policy } from '../../../shared/axiom-contract/mission-objects'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'

export function assertSupportedReadinessThreshold(
  threshold: Policy['readinessThreshold'] | undefined
): void {
  if (threshold === 'VERIFIED') {
    throw new OrchestrationError('invalid_argument', 'V1 supports only INTEGRATED dependencies', {
      reason: 'threshold_not_supported'
    })
  }
}
