import { defineMethod } from '../../core'
import { MessageListParams } from '../../../../../shared/axiom-contract/message-params'
import { getAxiomControlPlane } from '../../../../axiom/control-plane'

export const AXIOM_MESSAGE_METHODS = [
  defineMethod({
    name: 'axiom.message.list',
    params: MessageListParams,
    handler: (p, { runtime }) => {
      const { store, missions } = getAxiomControlPlane(runtime)
      missions.getMission(p.missionId)
      return { messages: store.listMessages(p) }
    }
  })
]
