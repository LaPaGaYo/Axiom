import type { MissionStatus, TaskStage } from './lifecycle'

type LifecycleLabel = { en: string; zh: string }

export const TASK_STAGE_LABELS: Record<TaskStage, LifecycleLabel> = {
  DEFINED: { en: 'Defined', zh: '已定义' },
  READY: { en: 'Ready', zh: '就绪' },
  RUNNING: { en: 'Running', zh: '执行中' },
  SUBMITTED: { en: 'Submitted, awaiting verification', zh: '已提交，待验证' },
  VERIFYING: { en: 'Verifying', zh: '验证中' },
  VERIFIED: { en: 'Verified', zh: '已验证' },
  INTEGRATION_READY: { en: 'Awaiting integration', zh: '待集成' },
  INTEGRATED: { en: 'Integrated', zh: '已集成' },
  NEEDS_FIX: { en: 'Needs fix', zh: '需修复' },
  BLOCKED: { en: 'Blocked', zh: '阻塞' },
  CANCELED: { en: 'Canceled', zh: '已取消' }
}

export const MISSION_STATUS_LABELS: Record<MissionStatus, LifecycleLabel> = {
  DRAFT: { en: 'Draft', zh: '草稿' },
  ANALYZING: { en: 'Analyzing', zh: '分析中' },
  PLAN_REVIEW: { en: 'Plan review', zh: '计划待审核' },
  PLANNED: { en: 'Planned', zh: '已规划' },
  EXECUTING: { en: 'Executing', zh: '执行中' },
  REPLANNING: { en: 'Replanning', zh: '重新规划中' },
  FINALIZING: { en: 'Finalizing', zh: '最终验证中' },
  READY_FOR_APPROVAL: { en: 'Awaiting delivery approval', zh: '待交付审批' },
  COMPLETED: { en: 'Completed', zh: '已完成' },
  PAUSED: { en: 'Paused', zh: '已暂停' },
  BLOCKED: { en: 'Blocked', zh: '阻塞' },
  FAILED: { en: 'Failed', zh: '失败' },
  CANCELED: { en: 'Canceled', zh: '已取消' }
}

// Count the authoritative stages returned by task.list, never Orca's projection.
export function countTaskStages(tasks: readonly { stage: TaskStage }[]): Record<TaskStage, number> {
  const counts = {
    DEFINED: 0,
    READY: 0,
    RUNNING: 0,
    SUBMITTED: 0,
    VERIFYING: 0,
    VERIFIED: 0,
    INTEGRATION_READY: 0,
    INTEGRATED: 0,
    NEEDS_FIX: 0,
    BLOCKED: 0,
    CANCELED: 0
  }
  for (const { stage } of tasks) {
    counts[stage] += 1
  }
  return counts
}
