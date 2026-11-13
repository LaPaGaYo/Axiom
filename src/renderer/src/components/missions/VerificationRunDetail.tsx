import { translate } from '@/i18n/i18n'
import type { VerificationRunView } from '../../../../shared/axiom-contract/verification-params'
import { readVerdictRecord } from '../../../../shared/axiom-contract/verdict-record'
import { VerificationChecks } from './VerificationChecks'
import { VerificationCriteria } from './VerificationCriteria'
import { VerificationDiff } from './VerificationDiff'
import { VerificationDisposition } from './VerificationDisposition'
import { VerificationStatus } from './VerificationStatus'

export function VerificationRunDetail({ run }: { run: VerificationRunView }) {
  const record = readVerdictRecord(run.verdictDetail)
  return (
    <section
      aria-labelledby="verification-run-heading"
      className="space-y-4 border-t border-border pt-3"
    >
      <h3 id="verification-run-heading" className="text-sm font-semibold">
        {translate('missions.verificationRunDetails', 'Run details')} ·{' '}
        <span className="break-all font-mono text-xs font-normal">{run.id}</span>
      </h3>
      <div className="space-y-1 text-xs">
        <p>
          <VerificationStatus value={run.status} />
          {record.resolution && (
            <> · {translate('missions.resolvedByPerson', 'Resolved by a person')}</>
          )}
        </p>
        {(record.phase ?? run.phase) && (
          <p>
            {translate('missions.verificationPhase', 'Phase')}:{' '}
            <span className="font-mono">{record.phase ?? run.phase}</span>
          </p>
        )}
        {(record.verdict || record.reason) && (
          <p>
            {translate('missions.checksOutcome', 'Checks outcome')}:{' '}
            {record.verdict && <VerificationStatus value={record.verdict} />}
            {record.reason && (
              <>
                {' '}
                · <span className="font-mono">{record.reason}</span>
              </>
            )}
          </p>
        )}
      </div>
      <VerificationChecks record={record} />
      <VerificationCriteria acceptance={record.acceptance} />
      <VerificationDiff diff={record.diff} />
      <VerificationDisposition record={record} />
      <section aria-labelledby="verification-tools-heading" className="space-y-2 text-xs">
        <h4 id="verification-tools-heading" className="text-sm font-medium">
          {translate('missions.toolVersions', 'Tool versions')}
        </h4>
        {Object.keys(run.toolVersions).length ? (
          <dl className="space-y-1">
            {Object.entries(run.toolVersions).map(([tool, version]) => (
              <div key={tool} className="flex gap-2">
                <dt className="font-mono">{tool}</dt>
                <dd className="font-mono">{version}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-muted-foreground">
            {translate('missions.noToolVersions', 'No tool versions recorded.')}
          </p>
        )}
      </section>
      <p className="break-all text-xs">
        {translate('missions.verdictArtifact', 'Verdict evidence Artifact')}:{' '}
        <span className="font-mono">{record.verdictArtifactId ?? '—'}</span>
      </p>
      {!!record.evidenceArtifactIds.length && (
        <ul
          aria-label={translate('missions.evidenceArtifacts', 'Evidence Artifacts')}
          className="space-y-1 text-xs text-muted-foreground"
        >
          {record.evidenceArtifactIds.map((id) => (
            <li key={id} className="break-all font-mono">
              {id}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
