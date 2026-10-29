import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { AgentSpec } from '../../../shared/axiom-contract/agent-spec'
import type { AxiomStore } from '../db/axiom-store'
import type { ControlPlaneWorkerStart } from '../../runtime/rpc/methods/orchestration/worker/control-plane-worker-start'
import { plannerMcpServer } from './planner-mcp-launch'
import { plannerDeniedInput } from './planner-denied-input'
import { settleClaudePlannerTurn } from './planner-turn-settlement'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { headlessAttemptDirectory } from './headless-attempt-files'
import {
  claudeIsolationSettings,
  claudeManagedSettings,
  CLAUDE_LAUNCH_ENV
} from './claude-launch-policy'
import { registerClaudeMissionSessionPins } from '../../claude/claude-mission-session-pins'
import type { AttemptLauncherDependencies } from './attempt-launcher'
import { ClaudeAccountRequiredError } from '../../claude-accounts/claude-account-required-error'
import { resolveHostAgentBaseEnvironment } from '../../runtime/structured-agent-shell-environment'
import { harnessEgressEnv } from './harness-egress-env'

export function claudePlannerLaunchPolicy(
  deps: AttemptLauncherDependencies,
  spec: AgentSpec
): Pick<ControlPlaneWorkerStart, 'structured'> {
  return spec.provider === 'claude'
    ? {
        structured: createClaudePlannerLaunch({
          store: deps.store,
          ...(deps.startWorker ? {} : { runtime: deps.runtime }),
          missionId: spec.missionId,
          model: spec.model,
          effort: spec.reasoning.effort,
          resolveBaseEnvironment: () =>
            (deps.resolveBaseEnvironment ?? resolveHostAgentBaseEnvironment)(
              deps.runtime.requireStore().getSettings()
            ),
          resolveAccountHome: async () =>
            (await deps.runtime.resolveClaudeHomeForWorkerLaunch?.()) ?? null
        })
      }
    : {}
}

export function createClaudePlannerLaunch(input: {
  store: AxiomStore
  runtime?: OrcaRuntimeService
  missionId: string
  model: string
  effort: AgentSpec['reasoning']['effort']
  resolveAccountHome: () => Promise<string | null>
  resolveBaseEnvironment?: () => Promise<NodeJS.ProcessEnv>
}): NonNullable<ControlPlaneWorkerStart['structured']> {
  return {
    prepare: async ({ dispatchId, sessionId }) => {
      // Keep dispatch and Mission ids valid command arguments.
      const id = z.string().regex(/^[\w-]+$/)
      id.parse(input.missionId)
      id.parse(dispatchId)
      const accountHomePath = await input.resolveAccountHome()
      if (!accountHomePath) {
        throw new ClaudeAccountRequiredError()
      }
      let mcpServers
      try {
        mcpServers = { axiom: plannerMcpServer(input.missionId, dispatchId, sessionId) }
      } catch (error) {
        input.store.appendAuditEvent({
          missionId: input.missionId,
          actor: 'MissionController',
          objectKind: 'attempt',
          objectId: dispatchId,
          event: 'planner.launch_failed',
          before: null,
          after: { reason: 'cli_launcher_unavailable' }
        })
        throw error
      }
      // The kernel applies strictMcpConfig: true when these Mission pins are present.
      const egress = ['darwin', 'linux'].includes(process.platform)
        ? harnessEgressEnv({
            provider: 'claude',
            inherited: await (input.resolveBaseEnvironment?.() ??
              resolveHostAgentBaseEnvironment({}))
          })
        : undefined
      const directory = headlessAttemptDirectory(dispatchId)
      const settingsPath = path.join(directory, 'planner-settings.json')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(
        settingsPath,
        JSON.stringify({
          ...claudeIsolationSettings(),
          permissions: {
            allow: [
              'Read',
              'Grep',
              'Glob',
              'LS',
              'Bash(git log:*)',
              'Bash(git diff:*)',
              'Bash(git show:*)',
              'mcp__axiom__plan_propose'
            ],
            deny: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch']
          }
        }),
        { mode: 0o600, flag: 'wx' }
      )
      const dispose = registerClaudeMissionSessionPins(dispatchId, sessionId, {
        settingsPath,
        env: { ...CLAUDE_LAUNCH_ENV, ...egress?.env },
        accountHomePath,
        skills: [],
        managedSettings: claudeManagedSettings('planner'),
        ...(input.model === 'policy-default' ? {} : { model: input.model }),
        effort: input.effort,
        mcpServers,
        onTurnSettled: (settlement) => {
          // An injected startWorker is a fake-kernel launch, with no real session to stop.
          if (!input.runtime) {
            return
          }
          void settleClaudePlannerTurn(
            input.runtime,
            input.store,
            {
              missionId: input.missionId,
              dispatchId
            },
            settlement
          ).catch(() => {
            console.warn('[axiom] Planner turn settlement unavailable', { dispatchId })
          })
        },
        denyPermission: (toolName, deniedInput) => {
          try {
            input.store.appendAuditEvent({
              missionId: input.missionId,
              actor: 'MissionController',
              objectKind: 'attempt',
              objectId: dispatchId,
              event: 'attempt.permission_denied',
              before: null,
              after: {
                toolName: /^[\w.:-]{1,128}$/.test(toolName) ? toolName : 'unknown',
                input: plannerDeniedInput(toolName, deniedInput),
                summary: 'Mission Planner denied a tool request outside its allow rules.'
              }
            })
          } catch {
            // Losing an audit must never turn a deny into a pending or authorized tool call.
            console.warn('[axiom] Planner permission denial audit unavailable', { dispatchId })
          }
        }
      })
      try {
        if (egress) {
          const { mode, noProxy, blackhole, overrides } = egress
          input.store.appendAuditEvent({
            missionId: input.missionId,
            actor: 'MissionController',
            objectKind: 'attempt',
            objectId: dispatchId,
            event: 'attempt.egress_pinned',
            before: null,
            after: {
              provider: 'claude',
              channel: 'structured',
              mode,
              noProxy,
              blackhole,
              overrides
            }
          })
        }
        return dispose
      } catch (error) {
        dispose()
        throw error
      }
    }
  }
}
