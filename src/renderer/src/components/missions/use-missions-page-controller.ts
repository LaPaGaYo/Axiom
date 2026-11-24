import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { axiomClient, AxiomRpcError } from '@/lib/axiom-client'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import type { CreateMissionInput } from './MissionCreateDialog'
import type { MissionAction } from './MissionActions'
import { useMissionsPageRead } from './use-missions-page-read'
import { planApprovalDescription } from './plan-approval'
import { createSupervisionActions } from './supervision-actions'
import { createPolicyActions } from './policy-actions'
import { missionErrorText } from './mission-error-text'

export function useMissionsPageController() {
  useTranslation()
  const selectedId = useAppStore((s) => s.selectedMissionId)
  const selectedTaskId = useAppStore((s) => s.selectedTaskId)
  const createOpen = useAppStore((s) => s.missionCreateOpen)
  const error = useAppStore((s) => s.missionError)
  const requests = useAppStore((s) => s.missionRequests)
  const [confirming, setConfirming] = useState(false)
  const confirmingRef = useRef(false)
  const confirm = useConfirmationDialog()
  const reportError = useCallback((failure: unknown, quiet = false) => {
    const message = missionErrorText(failure)
    useAppStore.getState().setMissionError(message)
    if (!quiet) {
      toast.error(message)
    }
  }, [])
  const { missions, detail, loading, refresh, canRead } = useMissionsPageRead(
    selectedId,
    selectedTaskId,
    reportError
  )
  useEffect(
    () =>
      installWindowVisibilityInterval({
        intervalMs: 5000,
        run: () => {
          const store = useAppStore.getState()
          if (
            !canRead() ||
            confirmingRef.current ||
            store.missionCreateOpen ||
            Object.values(store.missionRequests).some((request) => request.pending)
          ) {
            return
          }
          void refresh(true)
        }
      }),
    [canRead, refresh]
  )

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
    cancelLabel?: string,
    confirmVariant: 'default' | 'destructive' = 'destructive'
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
          confirmVariant,
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
    const plan = detail?.plans.find((revision) => revision.id === planRevisionId)
    if (!plan) {
      return
    }
    void confirmAction(
      translate('missions.approvePlan', 'Approve plan'),
      planApprovalDescription(plan),
      () =>
        mutate(JSON.stringify(['approve', params]), (id) => axiomClient.approvePlan(params, id)),
      translate('missions.keepReviewing', 'Keep reviewing'),
      'default'
    )
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
    ...createSupervisionActions(mutate, confirmAction),
    ...createPolicyActions(mutate, confirmAction),
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
    refresh: (_event?: unknown) => refresh(),
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
