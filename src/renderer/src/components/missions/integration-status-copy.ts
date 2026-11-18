import { translate } from '@/i18n/i18n'
import type { IntegrationBatchStatus } from '../../../../shared/axiom-contract/integration-batch'

export function integrationStatusLabel(status: IntegrationBatchStatus): string {
  switch (status) {
    case 'QUEUED':
      return translate('missions.integrationQueued', 'Queued')
    case 'APPLYING':
      return translate('missions.integrationApplying', 'Merging')
    case 'TESTING':
      return translate('missions.integrationTesting', 'Testing the merged tree')
    case 'PROMOTABLE':
      return translate('missions.integrationPromotable', 'Passed, waiting to be promoted')
    case 'PROMOTED':
      return translate('missions.integrationPromoted', 'Promoted')
    case 'CONFLICT':
      return translate('missions.integrationConflict', 'Merge conflict')
    case 'FAILED':
      return translate('missions.integrationFailed', 'Regression failed')
    case 'AWAITING_APPROVAL':
      return translate('missions.integrationAwaitingApproval', 'Awaiting approval')
    case 'REJECTED':
      return translate('missions.integrationRejected', 'Rejected')
    case 'SUPERSEDED':
      return translate('missions.integrationSuperseded', 'Superseded')
  }
}
