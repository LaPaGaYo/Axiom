import { create } from 'zustand'
import { expect, it } from 'vitest'
import { createMissionsSlice, type MissionsSlice } from './missions'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'

it('keeps Task selection within its Mission without interfering with pending receipts', () => {
  const store = create<MissionsSlice & { activeView: TopLevelView }>()((...args) => ({
    activeView: 'terminal',
    ...createMissionsSlice(...args)
  }))
  store.getState().selectMission('mission-1')
  store.getState().selectMissionTask('task-1')
  const requestId = store.getState().beginMissionRequest('plan')
  store.getState().selectMission('mission-1')
  expect(store.getState().selectedTaskId).toBe('task-1')
  store.getState().selectMission('mission-2')
  expect(store.getState().selectedTaskId).toBeNull()
  expect(store.getState().missionRequests.plan).toEqual({ id: requestId, pending: true })
  store.getState().finishMissionRequest('plan', true)
  expect(store.getState().beginMissionRequest('plan')).toBe(requestId)
})
