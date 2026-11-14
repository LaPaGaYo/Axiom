import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { axiomClient, AxiomRpcError } from '@/lib/axiom-client'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import type { MissionSummary } from '../../../../shared/axiom-contract/mission-params'
import type { CreateMissionInput } from './MissionCreateDialog'
import type { MissionAction } from './MissionActions'
import { readTaskEvidence } from './task-evidence-read'

async function readMission(missionId: string, taskId: string | null) {
  const pendingRead = Promise.allSettled([axiomClient.missionPending({ missionId })]).then(
    ([result]) => result
  )
  const [
    { mission },
    { tasks },
    { planRevisions },
    { attempts },
    { messages },
    taskDetail,
    pending
  ] = await Promise.all([
    axiomClient.showMission({ missionId }),
    axiomClient.listTasks({ missionId }),
    axiomClient.listPlans({ missionId }),
    axiomClient.listAttempts({ missionId }),
    axiomClient.listMessages({ missionId, pendingOnly: true }),
    taskId
      ? Promise.all([
          axiomClient.listAttempts({ missionId, taskId }),
          axiomClient.listMessages({ missionId, taskId }),
          readTaskEvidence(missionId, taskId, pendingRead)
        ]).then(([attempts, messages, evidence]) => ({
          taskId,
          ...attempts,
          ...messages,
          ...evidence
        }))
      : null,
    pendingRead
  ])
  const goal = mission.activeGoalRevisionId
    ? (await axiomClient.showGoal({ missionId, goalRevisionId: mission.activeGoalRevisionId }))
        .goalRevision
    : null
  return {
    mission,
    tasks,
    plans: planRevisions,
    goal,
    attempts,
    pendingMessages: messages,
    pendingItems: pending.status === 'fulfilled' ? pending.value.items : [],
    pendingError: pending.status === 'rejected',
    taskDetail
  }
}

export function useMissionsPageController() {
  useTranslation()
  const selectedId = useAppStore((s) => s.selectedMissionId)
  const selectedTaskId = useAppStore((s) => s.selectedTaskId)
  const createOpen = useAppStore((s) => s.missionCreateOpen)
  const error = useAppStore((s) => s.missionError)
  const requests = useAppStore((s) => s.missionRequests)
  const [missions, setMissions] = useState<MissionSummary[]>([])
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof readMission>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const confirmingRef = useRef(false)
  const generation = useRef(0)
  const confirm = useConfirmationDialog()
  const reportError = useCallback((failure: unknown) => {
    const message =
      failure instanceof AxiomRpcError ? `${failure.code}: ${failure.message}` : String(failure)
    useAppStore.getState().setMissionError(message)
    toast.error(message)
  }, [])
  const refresh = useCallback(async () => {
    const current = ++generation.current
    const { selectedMissionId: id, selectedTaskId: taskId } = useAppStore.getState()
    setLoading(true)
    try {
      const [list, next] = await Promise.all([
        axiomClient.listMissions(),
        id ? readMission(id, taskId) : null
      ])
      if (current !== generation.current) {
        return
      }
      setMissions(list.missions)
      setDetail(next)
      useAppStore.getState().setMissionError(null)
    } catch (failure) {
      if (current === generation.current) {
        reportError(failure)
      }
    } finally {
      if (current === generation.current) {
        setLoading(false)
      }
    }
  }, [reportError])
  useEffect(() => {
    void refresh()
    return () => {
      generation.current += 1
    }
  }, [selectedId, selectedTaskId, refresh])

  const mutate = async (key: string, operation: (id: string) => Promise<unknown>) => {
    const store = useAppStore.getState()
    const id = store.beginMissionRequest(key)
    if (!id) {
      return false
    }
    store.setMissionError(null)
    let failure: unknown
    let accepted = false
    try {
      await operation(id)
      accepted = true
    } catch (caught) {
      failure = caught
    }
    // Even a failed/uncertain mutation may have committed. Always reconcile.
    await refresh()
    store.finishMissionRequest(
      key,
      failure instanceof AxiomRpcError &&
        ['transport_error', 'invalid_response'].includes(failure.code)
    )
    if (failure) {
      reportError(failure)
    }
    return accepted
  }
  const create = (params: CreateMissionInput) =>
    mutate(JSON.stringify(['create', params]), async (id) => {
      const result = await axiomClient.createMission(params, id)
      useAppStore.getState().selectMission(result.mission.id)
      useAppStore.getState().setMissionCreateOpen(false)
    })
  const confirmAction = async (
    title: string,
    description: string,
    action: () => Promise<unknown>,
    cancelLabel?: string
  ) => {
    if (confirmingRef.current) {
      return
    }
    confirmingRef.current = true
    setConfirming(true)
    try {
      if (
        await confirm({
          title,
          description,
          confirmLabel: title,
          confirmVariant: 'destructive',
          cancelVariant: 'ghost',
          ...(cancelLabel ? { cancelLabel } : {})
        })
      ) {
        await action()
      }
    } finally {
      confirmingRef.current = false
      setConfirming(false)
    }
  }
  const missionAction = (action: MissionAction) => {
    if (!selectedId) {
      return
    }
    const params = { missionId: selectedId, reason: `User requested ${action} from Mission Home` }
    const run = () =>
      mutate(JSON.stringify([action, params]), (id) => {
        switch (action) {
          case 'plan':
            return axiomClient.planMission({ missionId: selectedId }, id)
          case 'start':
            return axiomClient.startMission({ missionId: selectedId }, id)
          case 'pause':
            return axiomClient.pauseMission(params, id)
          case 'resume':
            return axiomClient.resumeMission(params, id)
          case 'cancel':
            return axiomClient.cancelMission(params, id)
        }
      })
    if (action === 'cancel') {
      void confirmAction(
        translate('missions.cancel', 'Cancel Mission'),
        translate(
          'missions.cancelConsequence',
          'Cancel this Mission and its unfinished Tasks? This Mission cannot be resumed after cancellation.'
        ),
        run
      )
    } else {
      void run()
    }
  }
  const approve = (planRevisionId: string) => {
    const params = { planRevisionId, resolver: 'desktop-user' }
    void mutate(JSON.stringify(['approve', params]), (id) => axiomClient.approvePlan(params, id))
  }
  const answer = (questionId: string, body: string) => {
    if (!selectedId) {
      return
    }
    const params = { missionId: selectedId, questionId, body }
    return mutate(JSON.stringify(['answer', params]), (id) => axiomClient.answerMessage(params, id))
  }
  const resolve = (messageId: string, decision: 'accept' | 'reject', rationale: string) => {
    if (!selectedId) {
      return
    }
    const params = { missionId: selectedId, messageId, decision, rationale }
    return mutate(JSON.stringify(['resolve', params]), (id) =>
      axiomClient.resolveMessage(params, id)
    )
  }
  const reject = (planRevisionId: string, reason: string) => {
    const params = { planRevisionId, resolver: 'desktop-user', reason }
    void confirmAction(
      translate('missions.rejectPlan', 'Reject plan'),
      translate(
        'missions.rejectConsequence',
        'Reject this proposal? Its Tasks will not be approved. A new proposal will be needed to proceed.'
      ),
      () => mutate(JSON.stringify(['reject', params]), (id) => axiomClient.rejectPlan(params, id))
    )
  }
  const resolveVerification = (params: Parameters<typeof axiomClient.resolveVerification>[0]) =>
    mutate(JSON.stringify(['resolveVerification', params]), (id) =>
      axiomClient.resolveVerification(params, id)
    )
  const rerunVerification = (params: Parameters<typeof axiomClient.rerunVerification>[0]) =>
    mutate(JSON.stringify(['rerunVerification', params]), (id) =>
      axiomClient.rerunVerification(params, id)
    )
  const adjustTask = (params: Parameters<typeof axiomClient.adjustTask>[0]) =>
    mutate(JSON.stringify(['adjustTask', params]), (id) => axiomClient.adjustTask(params, id))
  const cancelTask = (params: Parameters<typeof axiomClient.cancelTask>[0], consequence: string) =>
    confirmAction(
      translate('missions.cancelTask', 'Cancel Task'),
      consequence,
      () =>
        mutate(JSON.stringify(['cancelTask', params]), (id) => axiomClient.cancelTask(params, id)),
      translate('missions.keepTask', 'Keep Task')
    )
  return {
    adjustTask,
    cancelTask,
    resolveVerification,
    rerunVerification,
    missions,
    detail: detail?.mission.id === selectedId ? detail : null,
    selectedId,
    selectedTaskId,
    taskDetail:
      detail?.mission.id === selectedId && detail.taskDetail?.taskId === selectedTaskId
        ? detail.taskDetail
        : null,
    loading,
    busy: loading || confirming || Object.values(requests).some((request) => request.pending),
    error,
    createOpen,
    create,
    refresh,
    missionAction,
    approve,
    reject,
    answer,
    resolve,
    selectTask: useAppStore.getState().selectMissionTask,
    select: useAppStore.getState().selectMission,
    setCreateOpen: useAppStore.getState().setMissionCreateOpen
  }
}

export type MissionsPageController = ReturnType<typeof useMissionsPageController>
