import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ComponentProps } from 'react'
import { translate } from '@/i18n/i18n'
import type { TaskListItem } from '../../../../shared/axiom-contract/task-params'
import { AttemptList } from './AttemptList'
import { SubmissionSummary } from './SubmissionSummary'
import { MessageTimeline } from './MessageTimeline'
import { TaskEvidenceStage } from './TaskEvidenceStage'
import { TaskWaitingLine } from './TaskWaitingLine'
import { TaskQuietCancel } from './TaskQuietCancel'
import { VerificationRecord } from './VerificationRecord'
import { useTaskVerification } from './use-task-verification'
import type { TaskEvidenceReads } from './task-evidence-read'
import {
  TaskVerificationActions,
  type TaskVerificationActionProps
} from './TaskVerificationActions'

export function TaskDetail({
  task,
  attempts,
  messages,
  onOpenWorktree,
  runs,
  verificationError,
  usage,
  usageError,
  tasks,
  onSelectTask,
  pendingItems,
  pendingError,
  onResolveVerification,
  onRerunVerification,
  taskSpec,
  onAdjustTask,
  onCancelTask,
  ...actions
}: ComponentProps<typeof MessageTimeline> &
  TaskEvidenceReads &
  TaskVerificationActionProps & {
    task: TaskListItem
    tasks?: readonly TaskListItem[]
    onSelectTask?: (id: string) => void
    onOpenWorktree: (worktreeId: string) => void
  }) {
  useTranslation()
  const verification = useTaskVerification(runs)
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
        <TaskEvidenceStage
          task={task}
          latest={verification.latest}
          failed={verificationError}
          onOpen={verification.openRun}
        />
        <TaskWaitingLine
          task={task}
          tasks={tasks}
          onSelectTask={onSelectTask}
          onSelectRun={verification.openRun}
        />
        <TaskVerificationActions
          task={task}
          pendingItems={pendingItems}
          pendingError={pendingError}
          runs={runs}
          busy={actions.busy}
          detailRef={section}
          onResolveVerification={onResolveVerification}
          onRerunVerification={onRerunVerification}
          taskSpec={taskSpec}
          messages={messages}
          onAdjustTask={onAdjustTask}
          onCancelTask={onCancelTask}
        />
        <TaskQuietCancel
          task={task}
          pendingItems={pendingItems}
          busy={actions.busy}
          detailRef={section}
          onCancelTask={onCancelTask}
        />
      </div>
      <AttemptList
        attempts={attempts}
        onOpenWorktree={onOpenWorktree}
        usage={usage}
        usageError={usageError}
      />
      <VerificationRecord
        runs={verification.newestFirst}
        selected={verification.selected}
        onSelect={verification.selectRun}
        failed={verificationError}
        regionRef={verification.region}
      />
      <SubmissionSummary submission={submission} />
      <MessageTimeline messages={messages} attempts={attempts} {...actions} />
    </section>
  )
}
