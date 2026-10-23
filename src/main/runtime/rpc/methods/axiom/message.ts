import { defineMethod } from '../../core'
import {
  MessageListParams,
  MessageAnswerParams,
  MessageResolveParams
} from '../../../../../shared/axiom-contract/message-params'
import { getAxiomControlPlane } from '../../../../axiom/control-plane'
import { answerMissionQuestion } from '../../../../axiom/messaging/question-answer'
import { resolveSubtask } from '../../../../axiom/messaging/subtask-resolution'
import { OrchestrationError } from '../../../orchestration/orchestration-error'

export const AXIOM_MESSAGE_METHODS = [
  defineMethod({
    name: 'axiom.message.answer',
    permission: 'workspace',
    params: MessageAnswerParams,
    handler: answerMissionQuestion
  }),
  defineMethod({
    name: 'axiom.message.resolve',
    permission: 'workspace',
    params: MessageResolveParams,
    handler: (p, { runtime, recordMutationReceipt }) => {
      const { store, missions } = getAxiomControlPlane(runtime)
      const result = store.transaction('subtask_resolution_receipt', () => {
        const result = resolveSubtask({ db: runtime.getOrchestrationDb(), store, missions }, p)
        if (result.resolved) {
          recordMutationReceipt?.(result)
        }
        return result
      })
      // Keep the failed-check audit durable while returning a rejected acceptance.
      if (!result.resolved) {
        throw new OrchestrationError('invalid_argument', 'Subtask checks failed.', {
          failed: result.failed
        })
      }
      return result
    }
  }),
  defineMethod({
    name: 'axiom.message.list',
    permission: 'workspace',
    params: MessageListParams,
    handler: (p, { runtime }) => {
      const { store, missions } = getAxiomControlPlane(runtime)
      missions.getMission(p.missionId)
      return { messages: store.listMessages(p) }
    }
  })
]
