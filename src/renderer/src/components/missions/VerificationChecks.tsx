import { translate } from '@/i18n/i18n'
import type { VerdictRecord } from '../../../../shared/axiom-contract/verdict-record'
import { CheckOutput } from './CheckOutput'
import { VerificationStatus, verificationDuration } from './VerificationStatus'

export function VerificationChecks({ record }: { record: VerdictRecord }) {
  return (
    <section aria-labelledby="verification-checks-heading" className="space-y-2">
      <h4 id="verification-checks-heading" className="text-sm font-medium">
        {translate('missions.verificationChecks', 'Checks')}
      </h4>
      {record.checks.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('missions.noRecordedChecks', 'No checks recorded.')}
        </p>
      ) : (
        <div className="overflow-x-auto scrollbar-sleek">
          <table
            className="w-full text-left text-xs"
            aria-label={translate('missions.verificationChecks', 'Checks')}
          >
            <thead>
              <tr className="border-b border-border">
                {[
                  translate('missions.checkIndex', 'Index'),
                  translate('missions.checkSource', 'Source'),
                  translate('missions.checkCommand', 'Command'),
                  translate('missions.checkResult', 'Result'),
                  translate('missions.checkExit', 'Exit code'),
                  translate('missions.duration', 'Duration')
                ].map((label) => (
                  <th key={label} className="px-3 py-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {record.checks.map((check, position) => (
                <tr key={`${check.index}:${position}`} className="border-b border-border align-top">
                  <td className="px-3 py-3 tabular-nums">#{check.index}</td>
                  <td className="px-3 py-3">{check.source ?? '—'}</td>
                  <td className="space-y-2 px-3 py-3">
                    <code className="whitespace-pre-wrap break-all font-mono">{check.command}</code>
                    {!!check.failures.length && (
                      <ul
                        className="space-y-1"
                        aria-label={translate(
                          'missions.checkFailures',
                          'Failure names for check {{index}}',
                          { index: check.index }
                        )}
                      >
                        {check.failures.map((failure) => (
                          <li key={failure} className="whitespace-pre-wrap break-all font-mono">
                            {failure}
                          </li>
                        ))}
                      </ul>
                    )}
                    <CheckOutput index={check.index} artifactId={record.verdictArtifactId} />
                  </td>
                  <td className="px-3 py-3">
                    <VerificationStatus value={check.result} />
                    {check.reason && (
                      <p className="font-mono text-muted-foreground">{check.reason}</p>
                    )}
                  </td>
                  <td className="px-3 py-3 tabular-nums">{check.exitCode ?? '—'}</td>
                  <td className="px-3 py-3 tabular-nums">
                    {verificationDuration(check.durationMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
