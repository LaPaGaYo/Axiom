import { describe, expect, it } from 'vitest'
import {
  AXIOM_CLI_COMMAND_NAMES,
  AXIOM_RPC_METHOD_PREFIXES,
  AXIOM_RPC_NAMESPACE
} from '../../shared/axiom-contract/namespace'
import { ALL_RPC_METHODS } from '../runtime/rpc/methods'
import { AXIOM_METHODS } from './namespace-rpc'

describe('Axiom RPC namespace', () => {
  it('registers namespace introspection in the runtime manifest', () => {
    expect(AXIOM_METHODS.map((method) => method.name)).toEqual(['axiom.namespace.get'])
    expect(ALL_RPC_METHODS.map((method) => method.name)).toContain('axiom.namespace.get')
  })

  it('keeps every runtime RPC method name unique', () => {
    const names = ALL_RPC_METHODS.map((method) => method.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('reserves the Axiom namespace and method prefixes for AXIOM_METHODS', () => {
    const namespacePrefix = `${AXIOM_RPC_NAMESPACE}.`
    expect(AXIOM_METHODS.filter((method) => !method.name.startsWith(namespacePrefix))).toEqual([])
    expect(ALL_RPC_METHODS.filter((method) => method.name.startsWith(namespacePrefix))).toEqual(
      AXIOM_METHODS
    )

    const axiomNames = new Set<string>(AXIOM_METHODS.map((method) => method.name))
    const collisions = ALL_RPC_METHODS.filter(
      (method) =>
        !axiomNames.has(method.name) &&
        AXIOM_RPC_METHOD_PREFIXES.some((prefix) => method.name.startsWith(prefix))
    )
    expect(collisions.map((method) => method.name)).toEqual([])
  })

  it('returns the shared reserved names without accessing the runtime', () => {
    const method = AXIOM_METHODS[0]
    expect(method.params).toBeNull()
    expect(
      method.handler(undefined, {
        get runtime(): never {
          throw new Error('Namespace introspection must not access the runtime')
        }
      })
    ).toEqual({
      namespace: AXIOM_RPC_NAMESPACE,
      methodPrefixes: AXIOM_RPC_METHOD_PREFIXES,
      cliCommandNames: AXIOM_CLI_COMMAND_NAMES
    })
  })
})
