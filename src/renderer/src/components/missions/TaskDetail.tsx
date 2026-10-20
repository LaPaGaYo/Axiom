import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ComponentProps } from 'react'
import { translate } from '@/i18n/i18n'
import type { TaskListItem } from '../../../../shared/axiom-contract/task-params'
import { AttemptList } from './AttemptList'
import { SubmissionSummary } from './SubmissionSummary'
import { MessageTimeline } from './MessageTimeline'
import { TaskStageBadge } from './TaskStageBadge'

export function TaskDetail({
  task,
  attempts,
  messages,
  onOpenWorktree,
  ...actions
}: ComponentProps<typeof MessageTimeline> & {
  task: TaskListItem
  onOpenWorktree: (worktreeId: string) => void
}) {
  useTranslation()
  const section = useRef<HTMLElement>(null)
  useEffect(() => {
    section.current?.focus({ preventScroll: true })
    section.current?.scrollIntoView?.({ block: 'nearest' })
  }, [task.id])
  const submission = [...attempts]
    .sort((a, b) => b.seq - a.seq)
    .find((a) => a.submission)?.submission
  return (
    <section
      ref={section}
      tabIndex={-1}
      className="space-y-5 rounded-md border border-border p-4"
      aria-labelledby="task-detail-heading"
    >
      <div className="space-y-2">
        <h2 id="task-detail-heading" className="text-sm font-semibold">
          {translate('missions.taskDetail', 'Task detail')}
        </h2>
        <p className="text-sm">{task.title}</p>
        <p className="break-all text-xs text-muted-foreground">{task.id}</p>
        <TaskStageBadge stage={task.stage} orcaStatus={task.orcaStatus} />
      </div>
      <AttemptList attempts={attempts} onOpenWorktree={onOpenWorktree} />
      <SubmissionSummary submission={submission} />
      <MessageTimeline messages={messages} attempts={attempts} {...actions} />
    </section>
  )
}
