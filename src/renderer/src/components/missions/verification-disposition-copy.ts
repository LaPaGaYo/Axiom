import { translate } from '@/i18n/i18n'
import type { VerificationDisposition } from '../../../../shared/axiom-contract/verification-disposition'

export function verificationDispositionGloss(disposition: VerificationDisposition): string {
  switch (disposition) {
    case 'fixed':
      return translate('missions.dispositionFixed', 'sent back to be fixed')
    case 'rejected':
      return translate('missions.dispositionRejected', 'the flag was wrong')
    case 'intentional':
      return translate('missions.dispositionIntentional', 'the flagged change is intended')
    case 'not_worth':
      return translate('missions.dispositionNotWorth', 'real, but not worth fixing')
  }
}
