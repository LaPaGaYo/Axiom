import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { vi } from 'vitest'
import { isOrcaSessionId } from '../../shared/orca-session-address'
import { RuntimeMessageWaiters } from '../runtime/runtime-message-waiters'
import { OrchestrationMailboxNotificationCoordinator } from '../runtime/orchestration/mailbox-notification-coordinator'
import type { OrchestrationDb } from '../runtime/orchestration/db'

export function mailboxRuntime(db: OrchestrationDb) {
  const waiters = new RuntimeMessageWaiters()
  const deps = {
    getDb: () => db,
    getMessageWaiters: waiters.get.bind(waiters),
    resolveMessageWaiter: waiters.resolveNotified.bind(waiters),
    deliverForHandle: vi.fn()
  }
  type Dependencies = ConstructorParameters<typeof OrchestrationMailboxNotificationCoordinator>[0]
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: tests use run: addresses only, which bypass terminal routing; unexpected terminal paths fail loudly.
  const notificationDeps = deps as unknown as Dependencies
  const notifications = new OrchestrationMailboxNotificationCoordinator(notificationDeps)
  const runtime = {
    getOrchestrationDb: () => db,
    waitForMessage: vi.fn(waiters.wait.bind(waiters)),
    notifyMessageArrived: notifications.notifyMessageArrived.bind(notifications)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: mailbox-only tests do not admit Workers; only the supplied methods are reached.
  return runtime as typeof runtime & OrcaRuntimeService
}

export function insertMail(db: OrchestrationDb, runId: string) {
  return db.insertMessage({
    from: 'term_sender',
    to: `run:${runId}`,
    runId,
    type: 'status',
    subject: 'M1 mailbox evidence'
  })
}

export function replaceRunBinding(db: OrchestrationDb, sessionId: string) {
  if (!isOrcaSessionId(sessionId)) {
    throw new Error('Expected a valid persisted Mission session id')
  }
  return db.createRun({
    objective: 'takeover',
    coordinatorHandle: null,
    coordinatorPaneKey: null,
    coordinatorOrcaSessionId: sessionId
  })
}
