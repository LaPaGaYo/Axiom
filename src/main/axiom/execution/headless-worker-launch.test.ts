import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CreateWorktreeResult } from '../../../shared/worktree/create-types'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { ArtifactStore } from '../artifacts/artifact-store'
import { ContextBuilder } from '../context-builder/context-builder'
import * as rules from '../context-builder/repository-rules'
import { AgentFactory } from '../agent-factory/agent-factory'
import { RulesEngine } from '../decision-engine/rules-engine'
import { PROVIDER_SELECTION_RULES } from '../agent-factory/provider-selection'
import { Scheduler } from '../scheduler/scheduler'
import { createAttemptLauncher, type AttemptWorkerStartArgs } from './attempt-launcher'
import * as files from './headless-attempt-files'
import * as paths from '../../codex/codex-home-paths'
import * as version from '../../codex/codex-hook-trust-derivation'
import { prepareCodexWorkerLaunchHome } from '../../codex/codex-worker-launch-home'
import { headlessWorkerCombination } from './worker-launch-combination'
import { observeSkillPackage } from '../../skills/skill-package-identity'
import { ManagedCodexHomeTemporarilyUnavailableError } from '../../codex-accounts/host-codex-managed-home-ownership'

let f: ReturnType<typeof planned>
let root: string
let homePath: string
let userHomePath: string
let provider: string
const allowlist = { skills: ['allowed', 'missing-skill'], mcpServers: ['missing-server'] }
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-launch-combination-'))
  homePath = path.join(root, 'account home')
  userHomePath = path.join(root, 'user')
  await mkdir(homePath)
  await mkdir(path.join(userHomePath, '.agents', 'skills', 'allowed'), { recursive: true })
  await writeFile(
    path.join(userHomePath, '.agents', 'skills', 'allowed', 'SKILL.md'),
    '# Allowed\n'
  )
  await writeFile(
    path.join(homePath, 'auth.json'),
    JSON.stringify({ OPENAI_API_KEY: 'synthetic-private-value' })
  )
  vi.stubEnv('ORCA_USER_DATA_PATH', root)
  vi.spyOn(paths, 'getSystemCodexHomePath').mockReturnValue(path.join(userHomePath, '.codex'))
  vi.spyOn(rules, 'readRepositoryRules').mockResolvedValue('Fixture rules')
  vi.spyOn(files, 'prepareHeadlessAttemptFiles').mockResolvedValue(path.join(root, 'attempt'))
  vi.spyOn(version, 'fingerprintCodex').mockReturnValue(root)
  vi.spyOn(version, 'probeCodexVersion').mockResolvedValue('codex-cli test')
  f = planned(fixture())
  f.controller.startExecution(f.missionId)
  provider = 'codex'
})
afterEach(async () => {
  f.db.close()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})
async function launch(home = true, refusal = false) {
  const artifacts = new ArtifactStore(f.store, root)
  const context = new ContextBuilder(f.store, artifacts)
  const factory = new AgentFactory(f.store, new RulesEngine(PROVIDER_SELECTION_RULES), async () => [
    provider
  ])
  const scheduler = new Scheduler(f.db, f.store, f.controller, context, factory, {
    launch: async () => {}
  })
  const attempt = (await scheduler.scheduleRound(f.missionId, 'manual')).admitted[0]
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fake kernel only consumes the worktree id and path.
  const worktree = { worktree: { id: 'wt-created', path: root } } as CreateWorktreeResult
  const runtime = {
    createManagedWorktree: vi.fn(async () => worktree),
    requireStore: (): ReturnType<OrcaRuntimeService['requireStore']> => {
      const store = {
        getSettings: () => ({
          agentCmdOverrides: { codex: '/fake/codex' },
          codexAccountHomeAllowlist: allowlist
        })
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this fake only needs the launch settings reads.
      return store as never
    }
  }
  let command: string | undefined
  const startWorker = vi.fn(async (args: AttemptWorkerStartArgs) => {
    command = (await args.controlPlane?.headless?.prepare('dispatch'))?.command
    return { taskId: args.params.task, dispatchId: 'dispatch', state: 'ready' }
  })
  await createAttemptLauncher({
    runtime,
    db: f.db,
    store: f.store,
    missions: f.controller,
    artifacts,
    startWorker,
    ...(home
      ? {
          codexWorkerHome: () =>
            prepareCodexWorkerLaunchHome({
              resolveHome: () => {
                if (refusal) {
                  throw new ManagedCodexHomeTemporarilyUnavailableError()
                }
                return homePath
              },
              allowlist,
              userHomePath
            })
        }
      : {})
  })(attempt)
  return { command, attempt }
}
const events = (event: string) =>
  f.store.listAuditEvents({ missionId: f.missionId }).filter((row) => row.event === event)
it('records the account combination on prepared and started, and one mismatch on the Attempt', async () => {
  const { command } = await launch()
  const skillPath = path.join(userHomePath, '.agents', 'skills', 'allowed')
  const combination = {
    requested: {
      harness: 'codex',
      channel: 'headless',
      model: 'policy-default',
      effort: 'medium',
      codexHome: 'selected-account',
      allowlist,
      hooks: 'off'
    },
    effective: {
      harnessVersion: 'codex-cli test',
      codexHome: { kind: 'account', path: homePath },
      configSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      token: 'not_applicable',
      userSkills: [
        {
          name: 'allowed',
          path: skillPath,
          digest: (await observeSkillPackage(skillPath)).observedDigest
        }
      ]
    }
  }
  for (const name of ['attempt.headless_prepared', 'attempt.started']) {
    expect(events(name)).toMatchObject([{ objectId: 'dispatch', after: { combination } }])
  }
  expect(events('attempt.launch_mismatch')).toMatchObject([
    {
      objectId: 'dispatch',
      after: { reasons: ['mcp_server_missing:missing-server', 'skill_missing:missing-skill'] }
    }
  ])
  expect(command).toContain('CODEX_HOME=')
  expect(JSON.stringify(f.store.listAuditEvents({ missionId: f.missionId }))).not.toContain(
    'synthetic-private-value'
  )
})
it('refuses an omitted account-home seam before launching', async () => {
  const { command, attempt } = await launch(false)
  expect(events('attempt.started')).toEqual([])
  expect(events('attempt.launch_failed')).toHaveLength(1)
  expect(command).toBeUndefined()
  expect(f.store.getTaskStage(attempt.taskId)?.stage).toBe('READY')
})
it('settles resolver refusals as launch failures', async () => {
  const { attempt } = await launch(true, true)
  expect(events('attempt.started')).toEqual([])
  expect(events('attempt.launch_failed')).toHaveLength(1)
  expect(f.store.getTaskStage(attempt.taskId)?.stage).toBe('READY')
})
it('records TUI attempts without a harness adapter', async () => {
  provider = 'claude'
  await launch(false)
  expect(events('attempt.started')[0].after).toMatchObject({
    combination: {
      requested: { harness: 'claude', channel: 'tui', model: 'policy-default', effort: 'medium' },
      effective: null,
      adapter: 'none'
    }
  })
})

it('records all account mismatch reasons together while allowing launch', async () => {
  await rm(path.join(homePath, 'auth.json'))
  vi.mocked(version.probeCodexVersion).mockResolvedValue(null)
  await launch()
  expect(events('attempt.started')).toHaveLength(1)
  expect(events('attempt.launch_mismatch')).toMatchObject([
    {
      after: {
        reasons: [
          'mcp_server_missing:missing-server',
          'skill_missing:missing-skill',
          'harness_version_unknown',
          'token_refresh_failed'
        ]
      }
    }
  ])
})
it('caches the version for a binary fingerprint and probes again when it changes', async () => {
  const { attempt } = await launch()
  const spec = f.store.getAgentSpec(attempt.agentSpecId)!.spec
  const home = { kind: 'unmanaged' as const, homePath: null }
  await Promise.all(
    [1, 2].map(() => headlessWorkerCombination(spec, home, allowlist, '/fake/codex'))
  )
  expect(version.probeCodexVersion).toHaveBeenCalledOnce()
  vi.mocked(version.fingerprintCodex).mockReturnValue(`${root}:replacement`)
  await headlessWorkerCombination(spec, home, allowlist, '/fake/codex')
  expect(version.probeCodexVersion).toHaveBeenCalledTimes(2)
})
