import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import {
  completionReportText,
  type CompletionReport
} from '../../../../shared/axiom-contract/completion-report'
import { reportRiskLabel } from './finalization-copy'
import { TASK_STAGE_LABELS } from '../../../../shared/axiom-contract/stage-labels'

export function MissionReport({ report }: { report: CompletionReport }) {
  useTranslation()
  const [showRaw, setShowRaw] = useState(false)
  const titles = new Map(report.tasks.map((task) => [task.taskId, task.title]))
  return (
    <section aria-labelledby="mission-report-heading" className="space-y-3">
      <h2 id="mission-report-heading" className="text-sm font-semibold">
        {translate('missions.completionReport', 'Completion report')}
      </h2>
      <div className="space-y-2 text-sm">
        <h3 className="font-medium">{translate('missions.goal', 'Goal')}</h3>
        <p className="whitespace-pre-wrap break-words">{report.goal.objective}</p>
        {report.goal.constraints.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground">
              {translate('missions.reportConstraints', 'Constraints')}
            </p>
            <ul className="list-disc space-y-1 pl-5">
              {report.goal.constraints.map((constraint, index) => (
                <li key={`${index}:${constraint}`} className="whitespace-pre-wrap break-words">
                  {constraint}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="overflow-x-auto scrollbar-sleek">
          <table
            className="w-full text-left text-sm"
            aria-label={translate(
              'missions.reportCriteria',
              'Criteria and the Tasks that cover them'
            )}
          >
            <thead>
              <tr className="border-b border-border">
                {[
                  translate('missions.reportCriterion', 'Criterion'),
                  translate('missions.reportCoveredBy', 'Covered by')
                ].map((label) => (
                  <th key={label} className="px-3 py-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.goal.criteria.map((criterion) => (
                <tr key={criterion.index} className="border-b border-border align-top">
                  <td className="whitespace-pre-wrap break-words px-3 py-3">
                    <span className="font-mono">#{criterion.index}</span> {criterion.text}
                  </td>
                  <td className="whitespace-pre-wrap break-words px-3 py-3">
                    {criterion.coveredBy.length ? (
                      <ul className="space-y-1">
                        {criterion.coveredBy.map((id, index) => (
                          <li
                            key={`${index}:${id}`}
                            className={titles.has(id) ? undefined : 'font-mono'}
                          >
                            {titles.get(id) ?? id}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <MissionReportTasks tasks={report.tasks} />
      <div className="space-y-2 text-sm">
        <h3 className="font-medium">
          {translate('missions.reportRecordedRisks', 'Risks the Control Plane recorded')}
        </h3>
        {report.risks.length ? (
          <ul className="list-disc space-y-2 pl-5">
            {report.risks.map((risk) => (
              <li
                key={`${risk.kind}:${risk.taskId}:${risk.kind === 'bypass_posture' ? risk.seq : risk.runId}`}
                className="space-y-1 whitespace-pre-wrap break-words"
              >
                <p>{reportRiskLabel(risk.kind)}</p>
                <p>{titles.get(risk.taskId) ?? risk.taskId}</p>
                {risk.kind === 'bypass_posture' ? (
                  <p>
                    {translate('missions.reportAttemptSeq', 'Attempt {{seq}}', { seq: risk.seq })}
                  </p>
                ) : (
                  <p className="font-mono">{risk.runId}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            {translate('missions.reportNoRecordedRisks', 'The Control Plane recorded no risk.')}
          </p>
        )}
      </div>
      <div className="space-y-2 text-sm">
        <h3 className="font-medium">{translate('missions.reportPlans', 'Plans')}</h3>
        {report.plans.map((plan) => (
          <div key={plan.id} className="space-y-1 whitespace-pre-wrap break-words">
            <p>
              {translate('missions.reportPlanRevision', 'Plan revision {{revision}}', {
                revision: plan.revision
              })}
            </p>
            <p className="font-mono">{plan.status}</p>
            <p className="font-mono">
              <span>{plan.provenance.kind}</span> <span>{plan.provenance.actor}</span>
              {plan.provenance.model !== undefined && (
                <>
                  {' '}
                  <span>{plan.provenance.model}</span>
                </>
              )}
            </p>
            {plan.risks.length > 0 && (
              <ul className="list-disc space-y-1 pl-5">
                {plan.risks.map((risk) => (
                  <li key={risk.id}>
                    <p>{risk.description}</p>
                    {risk.mitigation !== undefined && (
                      <p>
                        {translate('missions.reportMitigation', 'Mitigation: {{text}}', {
                          text: risk.mitigation
                        })}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-2 text-sm">
        <h3 className="font-medium">{translate('missions.reportCommits', 'Commits')}</h3>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">
              {translate('missions.finalizationIntegrationHead', 'Integration head')}
            </dt>
            <dd className="font-mono" title={report.commits.integrationHead}>
              {report.commits.integrationHead.slice(0, 7)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {translate('missions.finalizationTargetHead', 'Target head')}
            </dt>
            <dd className="font-mono" title={report.commits.targetHead}>
              {report.commits.targetHead.slice(0, 7)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {translate('missions.reportPromoted', 'Promoted commits')}
            </dt>
            <dd>
              <ul className="space-y-1">
                {report.commits.promoted.map((commit) => (
                  <li key={commit} className="font-mono" title={commit}>
                    {commit.slice(0, 7)}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
        <p>
          {translate('missions.reportDecisions', '{{total}} decision(s) recorded', {
            total: report.decisions.length
          })}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        aria-expanded={showRaw}
        onClick={() => setShowRaw(!showRaw)}
      >
        {showRaw
          ? translate('missions.hideRawReport', 'Hide raw JSON')
          : translate('missions.showRawReport', 'Show raw JSON')}
      </Button>
      {showRaw && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground scrollbar-sleek">
          {completionReportText(report)}
        </pre>
      )}
    </section>
  )
}

function MissionReportTasks({ tasks }: { tasks: CompletionReport['tasks'] }) {
  useTranslation()
  return (
    <>
      <div className="overflow-x-auto scrollbar-sleek">
        <table
          className="w-full text-left text-sm"
          aria-label={translate('missions.reportTasks', 'Tasks in the report')}
        >
          <thead>
            <tr className="border-b border-border">
              {[
                translate('missions.task', 'Task'),
                translate('missions.stage', 'Stage'),
                translate('missions.candidate', 'Candidate'),
                translate('missions.verification', 'Verification'),
                translate('missions.reportRegression', 'Regression'),
                translate('missions.integrationMergeCommit', 'Merge commit')
              ].map((label) => (
                <th key={label} className="px-3 py-2 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr
                key={task.taskId}
                data-report-task-id={task.taskId}
                className="border-b border-border align-top"
              >
                <td className="space-y-1 whitespace-pre-wrap break-words px-3 py-3">
                  <p>{task.title}</p>
                  {task.cancelRationale !== undefined && (
                    <p className="text-xs text-muted-foreground">
                      {translate('missions.reportCanceled', 'Canceled: {{rationale}}', {
                        rationale: task.cancelRationale
                      })}
                    </p>
                  )}
                </td>
                <td className="space-y-1 px-3 py-3">
                  <p>
                    {translate(`missions.stages.${task.stage}`, TASK_STAGE_LABELS[task.stage].en)}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{task.stage}</p>
                </td>
                {task.stage === 'INTEGRATED' ? (
                  <>
                    <td className="px-3 py-3 font-mono" title={task.candidate.commitSha}>
                      {task.candidate.commitSha.slice(0, 7)}
                    </td>
                    <td className="space-y-1 px-3 py-3">
                      <p className="font-mono">{task.verification.status}</p>
                      <p>
                        {translate(
                          'missions.reportChecksPassed',
                          '{{passed}} of {{total}} check(s) passed',
                          {
                            passed: task.verification.checks.filter(
                              (check) => check.result === 'pass'
                            ).length,
                            total: task.verification.checks.length
                          }
                        )}
                      </p>
                      {task.verification.resolution && (
                        <p>
                          {translate(
                            'missions.reportResolvedByPerson',
                            'Resolved by a person: {{verdict}}',
                            { verdict: task.verification.resolution.verdict }
                          )}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono">{task.integration.regressionStatus}</td>
                    <td className="px-3 py-3 font-mono" title={task.integration.mergeCommit}>
                      {task.integration.mergeCommit.slice(0, 7)}
                    </td>
                  </>
                ) : (
                  [0, 1, 2, 3].map((cell) => (
                    <td key={cell} className="px-3 py-3">
                      —
                    </td>
                  ))
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tasks.map((task) => {
        const summary = task.stage === 'INTEGRATED' ? task.summary : ''
        const groups =
          task.stage === 'INTEGRATED'
            ? [
                {
                  label: translate('missions.limitations', 'Limitations'),
                  entries: task.limitations
                },
                { label: translate('missions.risks', 'Risks'), entries: task.risks },
                { label: translate('missions.followUps', 'Follow-ups'), entries: task.followUps }
              ]
            : []
        if (
          !summary &&
          !groups.some((group) => group.entries.length) &&
          !task.openQuestions.length
        ) {
          return null
        }
        return (
          <div key={task.taskId} className="space-y-2 whitespace-pre-wrap break-words text-sm">
            <h3 className="font-medium">{task.title}</h3>
            {summary && (
              <div className="space-y-1">
                <p className="text-muted-foreground">
                  {translate('missions.reportWorkerSummary', 'Worker summary')}
                </p>
                <p>{summary}</p>
              </div>
            )}
            {groups
              .filter((group) => group.entries.length)
              .map((group) => (
                <div key={group.label} className="space-y-1">
                  <p className="text-muted-foreground">{group.label}</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {group.entries.map((entry, index) => (
                      <li key={`${index}:${entry}`}>{entry}</li>
                    ))}
                  </ul>
                </div>
              ))}
            {task.openQuestions.length > 0 && (
              <div className="space-y-1">
                <p className="text-muted-foreground">
                  {translate('missions.reportOpenQuestions', 'Open questions')}
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  {task.openQuestions.map((question) => (
                    <li key={`${question.source}:${question.id}`}>
                      <span className="font-mono text-xs text-muted-foreground">
                        {question.source}
                      </span>{' '}
                      <span>{question.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
