import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { axiomClient } from '@/lib/axiom-client'
import type { MissionFinalization as FinalizationRecord } from '../../../../shared/axiom-contract/mission-finalization'
import {
  COMPLETION_REPORT_MEDIA_TYPE,
  CompletionReportSchema,
  type CompletionReport
} from '../../../../shared/axiom-contract/completion-report'
import { finalizationGateLabel, finalizationStopLabel } from './finalization-copy'
import { missionErrorText } from './mission-error-text'
import { MissionReport } from './MissionReport'

type ReportRead =
  | { status: 'closed' | 'loading' | 'invalid' | 'mismatch' }
  | { status: 'failed'; reason: string }
  | { status: 'ready'; report: CompletionReport }

function ReportDisclosure({
  artifactId,
  reportSha256
}: {
  artifactId: string
  reportSha256: string
}) {
  useTranslation()
  const [read, setRead] = useState<ReportRead>({ status: 'closed' })
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current += 1
    },
    []
  )
  const toggle = async () => {
    const current = ++generation.current
    if (read.status !== 'closed') {
      setRead({ status: 'closed' })
      return
    }
    setRead({ status: 'loading' })
    let artifact: Awaited<ReturnType<typeof axiomClient.readArtifact>>
    try {
      artifact = await axiomClient.readArtifact({ id: artifactId })
    } catch (failure) {
      if (current === generation.current) {
        setRead({ status: 'failed', reason: missionErrorText(failure) })
      }
      return
    }
    if (current !== generation.current) {
      return
    }
    if (
      artifact.meta.kind !== 'completion_report' ||
      artifact.meta.mediaType.split(';')[0] !== COMPLETION_REPORT_MEDIA_TYPE
    ) {
      setRead({ status: 'invalid' })
      return
    }
    if (artifact.meta.sha256 !== reportSha256) {
      setRead({ status: 'mismatch' })
      return
    }
    try {
      const bytes = Uint8Array.from(atob(artifact.contentBase64), (character) =>
        character.charCodeAt(0)
      )
      const report = CompletionReportSchema.parse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      )
      setRead({ status: 'ready', report })
    } catch {
      setRead({ status: 'invalid' })
    }
  }
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        aria-expanded={read.status !== 'closed'}
        onClick={() => void toggle()}
      >
        {read.status === 'closed'
          ? translate('missions.showReport', 'Show report')
          : translate('missions.hideReport', 'Hide report')}
      </Button>
      {read.status === 'loading' && (
        <p role="status" className="text-sm text-muted-foreground">
          {translate('missions.loadingReport', 'Loading the report…')}
        </p>
      )}
      {read.status === 'mismatch' && (
        <p className="text-sm text-destructive">
          {translate(
            'missions.reportHashMismatch',
            'The stored report is not the one this finalization recorded.'
          )}
        </p>
      )}
      {(read.status === 'invalid' || read.status === 'failed') && (
        <div className="space-y-1 text-sm text-destructive">
          <p>
            {translate('missions.reportReadFailed', 'The completion report could not be read.')}
          </p>
          {read.status === 'failed' && (
            <p className="whitespace-pre-wrap break-words font-mono">{read.reason}</p>
          )}
        </div>
      )}
      {read.status === 'ready' && <MissionReport report={read.report} />}
    </div>
  )
}

export function MissionFinalization({ finalization }: { finalization?: FinalizationRecord }) {
  useTranslation()
  if (!finalization) {
    return null
  }
  return (
    <section aria-labelledby="mission-finalization-heading" className="space-y-3">
      <h2 id="mission-finalization-heading" className="text-sm font-semibold">
        {translate('missions.finalization', 'Finalization')}
      </h2>
      <div data-finalization-outcome={finalization.outcome} className="space-y-1 text-sm">
        <p className="font-mono">
          {finalization.outcome === 'ready' ? finalization.outcome : finalization.reason}
        </p>
        <p>
          {finalization.outcome === 'ready'
            ? translate('missions.finalizationPassed', 'All completion gate items passed')
            : finalizationStopLabel(finalization.reason)}
        </p>
      </div>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground">
            {translate('missions.finalizationRecorded', 'Recorded')}
          </dt>
          <dd>
            <time dateTime={finalization.at}>{finalization.at}</time>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {translate('missions.targetBranch', 'Target branch')}
          </dt>
          <dd className="break-all font-mono">{finalization.targetBranch}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {translate('missions.finalizationTargetHead', 'Target head')}
          </dt>
          <dd className="font-mono" title={finalization.targetHead}>
            {finalization.targetHead?.slice(0, 7) ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {translate('missions.finalizationIntegrationHead', 'Integration head')}
          </dt>
          <dd className="font-mono" title={finalization.integrationHead}>
            {finalization.integrationHead?.slice(0, 7) ?? '—'}
          </dd>
        </div>
      </dl>
      {finalization.gate ? (
        <div className="overflow-x-auto scrollbar-sleek">
          <table
            className="w-full text-left text-sm"
            aria-label={translate('missions.completionGate', 'Completion gate')}
          >
            <thead>
              <tr className="border-b border-border">
                {[
                  translate('missions.gateItem', 'Item'),
                  translate('missions.checkResult', 'Result'),
                  translate('missions.gateEvidence', 'Evidence'),
                  translate('missions.gateDetail', 'Detail')
                ].map((label) => (
                  <th key={label} className="px-3 py-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {finalization.gate.map((item) => (
                <tr
                  key={item.id}
                  data-gate-item={item.id}
                  data-gate-pass={item.pass}
                  className="border-b border-border align-top"
                >
                  <td className="space-y-1 px-3 py-3">
                    <p>{finalizationGateLabel(item.id)}</p>
                    <p className="font-mono text-xs text-muted-foreground">{item.id}</p>
                  </td>
                  <td className="px-3 py-3">
                    {item.pass
                      ? translate('missions.gatePassed', 'Passed')
                      : translate('missions.gateNotPassed', 'Not passed')}
                  </td>
                  <td className="px-3 py-3">
                    {translate('missions.gateEvidenceCount', '{{total}} reference(s)', {
                      total: item.evidence.length
                    })}
                  </td>
                  <td className="whitespace-pre-wrap break-words px-3 py-3">
                    {item.detail ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate('missions.gateNotEvaluated', 'The completion gate was not evaluated.')}
        </p>
      )}
      {finalization.outcome === 'ready' &&
        (finalization.reportArtifactId && finalization.reportSha256 ? (
          <>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">
                  {translate('missions.reportArtifact', 'Report artifact')}
                </dt>
                <dd className="space-y-1 break-all font-mono">
                  <p>{finalization.reportArtifactId}</p>
                  <p title={finalization.reportSha256} data-testid="completion-report-sha">
                    {finalization.reportSha256.slice(0, 12)}
                  </p>
                </dd>
              </div>
            </dl>
            <ReportDisclosure
              key={`${finalization.reportArtifactId}:${finalization.reportSha256}`}
              artifactId={finalization.reportArtifactId}
              reportSha256={finalization.reportSha256}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {translate(
              'missions.noCompletionReport',
              'This finalization recorded no completion report.'
            )}
          </p>
        ))}
    </section>
  )
}
