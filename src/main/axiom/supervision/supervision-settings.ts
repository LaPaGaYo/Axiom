import type { z } from 'zod'
import {
  SupervisionShowParams,
  SupervisionShowResponse,
  SupervisionUpdateParams,
  type StallMode
} from '../../../shared/axiom-contract/supervision'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { AxiomStore } from '../db/axiom-store'
import { MissionControllerError } from '../mission-controller/controller-context'
import { listStallNotifications } from './stall-notifications'

type SupervisionContext = { db: OrchestrationDb; store: AxiomStore }

export function effectiveStallMode(store: AxiomStore, missionId: string): StallMode {
  return (
    store.getSupervisionSetting({ rule: 'stalled', missionId })?.mode ??
    store.getSupervisionSetting({ rule: 'stalled' })?.mode ??
    'observe'
  )
}

function requireMission(store: AxiomStore, missionId?: string) {
  if (missionId !== undefined && !store.getMission(missionId)) {
    throw new MissionControllerError('mission_not_found', { missionId })
  }
}

export function showSupervision(
  ctx: SupervisionContext,
  input: z.input<typeof SupervisionShowParams>
) {
  const { missionId } = SupervisionShowParams.parse(input)
  requireMission(ctx.store, missionId)
  const global = ctx.store.getSupervisionSetting({ rule: 'stalled' })
  const globalMode = global?.mode ?? 'observe'
  const missionMode =
    missionId === undefined
      ? undefined
      : (ctx.store.getSupervisionSetting({ rule: 'stalled', missionId })?.mode ?? null)
  return SupervisionShowResponse.parse({
    rules: [
      {
        rule: 'stalled',
        globalMode,
        globalSource: global ? 'user' : 'built_in',
        ...(missionMode === undefined
          ? {}
          : { missionMode, effectiveMode: missionMode ?? globalMode })
      }
    ],
    notifications: listStallNotifications(ctx.db, missionId)
  })
}

export function updateSupervision(
  ctx: SupervisionContext,
  input: z.input<typeof SupervisionUpdateParams>
) {
  const p = SupervisionUpdateParams.parse(input)
  if (p.missionId === undefined && p.mode === null) {
    throw Object.assign(new Error('The global stall mode cannot be cleared'), {
      code: 'invalid_argument'
    })
  }
  return ctx.store.transaction('supervision_update', () => {
    requireMission(ctx.store, p.missionId)
    const before =
      ctx.store.getSupervisionSetting({ rule: p.rule, missionId: p.missionId })?.mode ??
      (p.missionId === undefined ? 'observe' : null)
    if (before !== p.mode) {
      ctx.store.appendSupervisionSetting({ ...p, actor: 'user', provenance: { kind: 'user' } })
      if (p.missionId !== undefined) {
        ctx.store.appendAuditEvent({
          missionId: p.missionId,
          actor: 'user',
          objectKind: 'mission',
          objectId: p.missionId,
          event: 'supervision.updated',
          before: null,
          after: { rule: p.rule, before, after: p.mode }
        })
      }
    }
    return showSupervision(ctx, { missionId: p.missionId })
  })
}
