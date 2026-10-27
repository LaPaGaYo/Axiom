import type { ElectronApplication } from '@stablyai/playwright-test'

/** The fake CLI implements the terminal protocol only. Refuse structured creation at the
 * existing host-support boundary; an SDK launch failure must never grant this downgrade. */
export async function installClaudePlannerTerminalFallback(app: ElectronApplication) {
  await app.evaluate(async () => {
    type Runtime = {
      getStructuredAgentSessionCreateSupport: (
        worktree: string,
        agent: string
      ) => Promise<{ supported: boolean; reason?: string }>
    }
    type Method = {
      name: string
      handler: (params: unknown, context: { runtime: Runtime }) => unknown
    }
    const load = (await import('node:module')).createRequire(`${process.cwd()}/`)
    const methods = new Set<Method>()
    for (const module of Object.values(load.cache)) {
      if (!module?.filename.includes('/out/main/')) {
        continue
      }
      for (const value of Object.values(module.exports ?? {})) {
        if (!Array.isArray(value)) {
          continue
        }
        for (const entry of value) {
          if (entry?.name === 'axiom.mission.plan' && typeof entry.handler === 'function') {
            methods.add(entry)
          }
        }
      }
    }
    if (methods.size !== 1) {
      throw new Error(`Expected one registered Mission planner method, found ${methods.size}`)
    }
    const method = [...methods][0]!
    const original = method.handler
    const probe = { supportCalls: 0 }
    Object.assign(globalThis, { __axiomClaudePlannerFallback: probe })
    method.handler = async (params, context) => {
      const runtime = context.runtime
      const support = runtime.getStructuredAgentSessionCreateSupport
      runtime.getStructuredAgentSessionCreateSupport = async (worktree, agent) => {
        if (agent === 'claude') {
          probe.supportCalls += 1
          return { supported: false, reason: 'agent' }
        }
        return support.call(runtime, worktree, agent)
      }
      try {
        return await original(params, context)
      } finally {
        runtime.getStructuredAgentSessionCreateSupport = support
        method.handler = original
      }
    }
  })
}

export function claudePlannerFallbackCalls(app: ElectronApplication) {
  return app.evaluate(() => {
    const probe =
      '__axiomClaudePlannerFallback' in globalThis
        ? globalThis.__axiomClaudePlannerFallback
        : undefined
    return typeof probe === 'object' &&
      probe !== null &&
      'supportCalls' in probe &&
      typeof probe.supportCalls === 'number'
      ? probe.supportCalls
      : 0
  })
}
