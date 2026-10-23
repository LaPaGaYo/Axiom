import {
  AXIOM_CLI_COMMAND_NAMES,
  AXIOM_RPC_METHOD_PREFIXES,
  AXIOM_RPC_NAMESPACE
} from '../../shared/axiom-contract/namespace'
import { defineMethod } from '../runtime/rpc/core'

export const namespaceMethod = defineMethod({
  name: 'axiom.namespace.get',
    permission: 'workspace',
  params: null,
  handler: () => ({
    namespace: AXIOM_RPC_NAMESPACE,
    methodPrefixes: AXIOM_RPC_METHOD_PREFIXES,
    cliCommandNames: AXIOM_CLI_COMMAND_NAMES
  })
})
