import { formatOrcaSessionAddress, isOrcaSessionId } from '../../../shared/orca-session-address'
import type { OrchestrationSessionCaller } from '../../runtime/orchestration/orchestration-caller-identity'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'

export function missionCaller(sessionId: string, workspaceId: string): OrchestrationSessionCaller {
  if (!isOrcaSessionId(sessionId)) {
    throw new OrchestrationError('invalid_argument', 'Invalid Mission coordinator session id.')
  }
  return {
    address: formatOrcaSessionAddress(sessionId),
    terminalHandle: null,
    paneKey: null,
    orcaSessionId: sessionId,
    sessionId,
    workspaceId
  }
}
