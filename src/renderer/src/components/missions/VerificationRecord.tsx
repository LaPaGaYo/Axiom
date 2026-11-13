import type { Ref } from 'react'
import { translate } from '@/i18n/i18n'
import type { VerificationRunView } from '../../../../shared/axiom-contract/verification-params'
import { VerificationRuns } from './VerificationRuns'
import { VerificationRunDetail } from './VerificationRunDetail'

export function VerificationRecord({
  runs,
  selected,
  onSelect,
  failed,
  regionRef
}: {
  runs: readonly VerificationRunView[]
  selected?: VerificationRunView
  onSelect: (id: string) => void
  failed?: boolean
  regionRef: Ref<HTMLElement>
}) {
  return (
    <section
      ref={regionRef}
      tabIndex={-1}
      aria-labelledby="verification-heading"
      className="space-y-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <h3 id="verification-heading" className="text-sm font-semibold">
        {translate('missions.verification', 'Verification')}
      </h3>
      {failed ? (
        <p className="text-sm text-muted-foreground">
          {translate(
            'missions.verificationReadFailed',
            'Verification could not be read. Refresh to try again.'
          )}
        </p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate('missions.noVerificationRuns', 'No verification runs yet.')}
        </p>
      ) : (
        <>
          <VerificationRuns runs={runs} selectedId={selected?.id} onSelect={onSelect} />
          {selected && (
            <VerificationRunDetail key={`${selected.id}:${selected.updatedAt}`} run={selected} />
          )}
        </>
      )}
    </section>
  )
}
