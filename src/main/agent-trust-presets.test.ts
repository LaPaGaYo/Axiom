import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = {
  fakeHomeDir: '',
  userDataDir: '',
  previousUserDataPath: undefined as string | undefined
}

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') {
        return testState.userDataDir
      }
      throw new Error(`unexpected app.getPath(${name})`)
    }
  }
}))

vi.mock('node:os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => testState.fakeHomeDir
  }
})

const {
  markAntigravityWorkspaceTrusted,
  markCodexProjectTrusted,
  markCopilotFolderTrusted,
  markCursorWorkspaceTrusted
} = await import('./agent-trust-presets')
const { runExclusivelyForCodexTrustConfig } =
  await import('./codex/codex-trust-config-mutation-queue')

beforeEach(() => {
  testState.fakeHomeDir = mkdtempSync(join(tmpdir(), 'orca-trust-presets-'))
  testState.userDataDir = mkdtempSync(join(tmpdir(), 'orca-trust-presets-user-data-'))
  vi.stubEnv('HOME', testState.fakeHomeDir)
  vi.stubEnv('USERPROFILE', testState.fakeHomeDir)
  testState.previousUserDataPath = process.env.ORCA_USER_DATA_PATH
  process.env.ORCA_USER_DATA_PATH = testState.userDataDir
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(testState.fakeHomeDir, { recursive: true, force: true })
  rmSync(testState.userDataDir, { recursive: true, force: true })
  if (testState.previousUserDataPath === undefined) {
    delete process.env.ORCA_USER_DATA_PATH
  } else {
    process.env.ORCA_USER_DATA_PATH = testState.previousUserDataPath
  }
  testState.fakeHomeDir = ''
  testState.userDataDir = ''
  testState.previousUserDataPath = undefined
})

describe('markCursorWorkspaceTrusted', () => {
  it('writes ~/.cursor/projects/<slug>/.workspace-trusted with the cwd payload', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'orca-cursor-ws-'))
    try {
      markCursorWorkspaceTrusted(workspace)
      const projectsDir = join(testState.fakeHomeDir, '.cursor', 'projects')
      const slugDirs = readdirSync(projectsDir)
      expect(slugDirs.length).toBe(1)
      const trustFile = join(projectsDir, slugDirs[0], '.workspace-trusted')
      expect(existsSync(trustFile)).toBe(true)
      const payload = JSON.parse(readFileSync(trustFile, 'utf-8'))
      expect(payload.workspacePath).toBeTruthy()
      expect(typeof payload.trustedAt).toBe('string')
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('is idempotent — re-marking the same workspace does not overwrite trustedAt', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'orca-cursor-ws-'))
    try {
      markCursorWorkspaceTrusted(workspace)
      const projectsDir = join(testState.fakeHomeDir, '.cursor', 'projects')
      const slugDirs = readdirSync(projectsDir)
      const trustFile = join(projectsDir, slugDirs[0], '.workspace-trusted')
      const firstPayload = readFileSync(trustFile, 'utf-8')
      markCursorWorkspaceTrusted(workspace)
      const secondPayload = readFileSync(trustFile, 'utf-8')
      expect(secondPayload).toBe(firstPayload)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('markCopilotFolderTrusted', () => {
  it('appends the workspace to trustedFolders in ~/.copilot/config.json', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'orca-copilot-ws-'))
    try {
      markCopilotFolderTrusted(workspace)
      const configPath = join(testState.fakeHomeDir, '.copilot', 'config.json')
      expect(existsSync(configPath)).toBe(true)
      const parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
      expect(Array.isArray(parsed.trustedFolders)).toBe(true)
      expect(parsed.trustedFolders.length).toBe(1)
      expect(typeof parsed.trustedFolders[0]).toBe('string')
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('keeps a token-bearing config.json owner-only', () => {
    if (process.platform === 'win32') {
      return
    }
    const workspace = mkdtempSync(join(tmpdir(), 'orca-copilot-ws-'))
    const configPath = join(testState.fakeHomeDir, '.copilot', 'config.json')
    // Why: a restrictive runner umask would mask a dropped mode.
    const originalUmask = process.umask(0o022)
    try {
      mkdirSync(join(testState.fakeHomeDir, '.copilot'), { recursive: true })
      writeFileSync(configPath, JSON.stringify({ copilotTokens: { a: 'secret' } }), {
        mode: 0o600
      })
      markCopilotFolderTrusted(workspace)
      expect(statSync(configPath).mode & 0o777).toBe(0o600)
      expect(JSON.parse(readFileSync(configPath, 'utf-8')).copilotTokens).toEqual({ a: 'secret' })
    } finally {
      process.umask(originalUmask)
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('creates a missing config.json owner-only', () => {
    if (process.platform === 'win32') {
      return
    }
    const workspace = mkdtempSync(join(tmpdir(), 'orca-copilot-ws-'))
    const originalUmask = process.umask(0o022)
    try {
      markCopilotFolderTrusted(workspace)
      const configPath = join(testState.fakeHomeDir, '.copilot', 'config.json')
      expect(statSync(configPath).mode & 0o777).toBe(0o600)
    } finally {
      process.umask(originalUmask)
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('preserves existing config keys and dedups already-trusted folders', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'orca-copilot-ws-'))
    const realpath = realpathSync(workspace)
    try {
      mkdirSync(join(testState.fakeHomeDir, '.copilot'), { recursive: true })
      writeFileSync(
        join(testState.fakeHomeDir, '.copilot', 'config.json'),
        JSON.stringify({
          firstLaunchAt: '2026-01-01T00:00:00.000Z',
          trustedFolders: [realpath]
        })
      )
      markCopilotFolderTrusted(workspace)
      const parsed = JSON.parse(
        readFileSync(join(testState.fakeHomeDir, '.copilot', 'config.json'), 'utf-8')
      )
      expect(parsed.firstLaunchAt).toBe('2026-01-01T00:00:00.000Z')
      expect(parsed.trustedFolders).toHaveLength(1)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('markAntigravityWorkspaceTrusted', () => {
  it('appends the workspace to trustedWorkspaces in ~/.gemini/antigravity-cli/settings.json', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'orca-agy-ws-'))
    try {
      markAntigravityWorkspaceTrusted(workspace)
      const configPath = join(testState.fakeHomeDir, '.gemini', 'antigravity-cli', 'settings.json')
      expect(existsSync(configPath)).toBe(true)
      const parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
      expect(Array.isArray(parsed.trustedWorkspaces)).toBe(true)
      expect(parsed.trustedWorkspaces).toHaveLength(1)
      expect(parsed.trustedWorkspaces[0]).toBe(realpathSync(workspace))
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  // Why: the same settings.json also carries model, permissions and toolPermission. A
  // clobbering write here would silently reset the user's agy configuration.
  it('preserves sibling settings keys and dedups an already-trusted workspace', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'orca-agy-ws-'))
    const realpath = realpathSync(workspace)
    try {
      mkdirSync(join(testState.fakeHomeDir, '.gemini', 'antigravity-cli'), { recursive: true })
      writeFileSync(
        join(testState.fakeHomeDir, '.gemini', 'antigravity-cli', 'settings.json'),
        JSON.stringify({
          agentMode: 'accept-edits',
          model: 'gemini-3.8-flash',
          trustedWorkspaces: [realpath]
        })
      )
      markAntigravityWorkspaceTrusted(workspace)
      const parsed = JSON.parse(
        readFileSync(
          join(testState.fakeHomeDir, '.gemini', 'antigravity-cli', 'settings.json'),
          'utf-8'
        )
      )
      expect(parsed.agentMode).toBe('accept-edits')
      expect(parsed.model).toBe('gemini-3.8-flash')
      expect(parsed.trustedWorkspaces).toHaveLength(1)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  // Why: agy's trust is exact-path, not inherited — a parent entry does not cover a child,
  // which is what makes the per-worktree preflight necessary at all.
  it('adds a child worktree even when its parent is already trusted', () => {
    const parent = mkdtempSync(join(tmpdir(), 'orca-agy-parent-'))
    const child = join(parent, 'child-worktree')
    try {
      mkdirSync(child, { recursive: true })
      markAntigravityWorkspaceTrusted(parent)
      markAntigravityWorkspaceTrusted(child)
      const parsed = JSON.parse(
        readFileSync(
          join(testState.fakeHomeDir, '.gemini', 'antigravity-cli', 'settings.json'),
          'utf-8'
        )
      )
      expect(parsed.trustedWorkspaces).toHaveLength(2)
      expect(parsed.trustedWorkspaces).toContain(realpathSync(child))
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})

describe('markCodexProjectTrusted', () => {
  // Why (#16441): a hook install/grant holds this file across an awaited
  // app-server session; an unqueued write here lands inside its
  // capture->restore window and is silently reverted.
  it('queues behind an in-flight Codex trust-config mutation', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'orca-codex-ws-'))
    const configPath = join(testState.fakeHomeDir, '.codex', 'config.toml')
    let releaseGrant!: () => void
    const grantHoldingTheFile = new Promise<void>((resolve) => {
      releaseGrant = resolve
    })
    try {
      const held = runExclusivelyForCodexTrustConfig(configPath, () => grantHoldingTheFile)
      const marked = markCodexProjectTrusted(workspace)
      await Promise.resolve()
      expect(existsSync(configPath)).toBe(false)

      releaseGrant()
      await held
      await marked
      expect(readFileSync(configPath, 'utf-8')).toContain('trust_level = "trusted"')
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it.each(['linked', 'bare', 'separate-git-dir', 'main'] as const)(
    'trusts only the workspace realpath for a %s checkout',
    async (layout) => {
      const fixtureRoot = join(testState.fakeHomeDir, 'fixture')
      const repository = join(fixtureRoot, 'repo')
      const workspace = layout === 'main' ? repository : join(fixtureRoot, 'worktrees', 'feature')
      const gitDir = layout === 'bare' ? repository : join(repository, '.git')
      const worktreeGitDir = join(gitDir, 'worktrees', 'feature')
      mkdirSync(worktreeGitDir, { recursive: true })
      mkdirSync(workspace, { recursive: true })
      if (layout !== 'main') {
        const metadata =
          layout === 'separate-git-dir' ? join(fixtureRoot, 'metadata') : worktreeGitDir
        mkdirSync(metadata, { recursive: true })
        writeFileSync(join(workspace, '.git'), `gitdir: ${metadata}\n`)
        writeFileSync(join(metadata, 'gitdir'), join(workspace, '.git'))
      }

      await markCodexProjectTrusted(workspace)

      for (const configPath of [
        join(testState.fakeHomeDir, '.codex', 'config.toml'),
        join(testState.userDataDir, 'codex-runtime-home', 'home', 'config.toml')
      ]) {
        const written = readFileSync(configPath, 'utf8')
        expect(written).toBe(
          `[projects."${escapeTomlBasicString(realpathSync.native(workspace))}"]\ntrust_level = "trusted"\n`
        )
      }
    }
  )

  it('preserves an older main-checkout trust entry while trusting a linked workspace', async () => {
    const repository = join(testState.fakeHomeDir, 'repo')
    const workspace = join(testState.fakeHomeDir, 'worktree')
    const metadata = join(repository, '.git', 'worktrees', 'feature')
    mkdirSync(metadata, { recursive: true })
    mkdirSync(workspace)
    writeFileSync(join(workspace, '.git'), `gitdir: ${metadata}\n`)
    writeFileSync(join(metadata, 'gitdir'), join(workspace, '.git'))
    const oldEntry = `# user's existing decision\n[projects."${escapeTomlBasicString(realpathSync.native(repository))}"]\ntrust_level = "untrusted"\n`
    const configDirs = [
      join(testState.fakeHomeDir, '.codex'),
      join(testState.userDataDir, 'codex-runtime-home', 'home')
    ]
    for (const dir of configDirs) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'config.toml'), oldEntry)
    }

    await markCodexProjectTrusted(workspace)

    for (const dir of configDirs) {
      const written = readFileSync(join(dir, 'config.toml'), 'utf8')
      expect(written).toContain(oldEntry)
      expect(written).toContain(
        `[projects."${escapeTomlBasicString(realpathSync.native(workspace))}"]\ntrust_level = "trusted"`
      )
    }
  })

  it('writes ~/.codex/config.toml with the project marked trusted', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'orca-codex-ws-'))
    try {
      const realpath = realpathSync.native(workspace)
      await markCodexProjectTrusted(workspace)
      const configPath = join(testState.fakeHomeDir, '.codex', 'config.toml')
      const runtimeConfigPath = join(
        testState.userDataDir,
        'codex-runtime-home',
        'home',
        'config.toml'
      )
      expect(existsSync(configPath)).toBe(true)
      expect(existsSync(runtimeConfigPath)).toBe(true)
      const written = readFileSync(configPath, 'utf-8')
      const runtimeWritten = readFileSync(runtimeConfigPath, 'utf-8')
      expect(written).toContain(`[projects."${escapeTomlBasicString(realpath)}"]`)
      expect(written).toContain('trust_level = "trusted"')
      expect(runtimeWritten).toContain(`[projects."${escapeTomlBasicString(realpath)}"]`)
      expect(runtimeWritten).toContain('trust_level = "trusted"')
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('preserves existing config keys and updates an existing project block', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'orca-codex-ws-'))
    const realpath = realpathSync.native(workspace)
    try {
      const codexDir = join(testState.fakeHomeDir, '.codex')
      const runtimeCodexDir = join(testState.userDataDir, 'codex-runtime-home', 'home')
      mkdirSync(codexDir, { recursive: true })
      mkdirSync(runtimeCodexDir, { recursive: true })
      writeFileSync(
        join(codexDir, 'config.toml'),
        [
          'model = "gpt-5.5"',
          '',
          `[projects."${escapeTomlBasicString(realpath)}"]`,
          'notes = "keep"',
          'trust_level = "untrusted"',
          ''
        ].join('\n'),
        'utf-8'
      )
      writeFileSync(
        join(runtimeCodexDir, 'config.toml'),
        [
          'sandbox_mode = "workspace-write"',
          '',
          `[projects."${escapeTomlBasicString(realpath)}"]`,
          'notes = "keep-runtime"',
          'trust_level = "untrusted"',
          ''
        ].join('\n'),
        'utf-8'
      )

      await markCodexProjectTrusted(workspace)

      const written = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      const runtimeWritten = readFileSync(join(runtimeCodexDir, 'config.toml'), 'utf-8')
      expect(written).toContain('model = "gpt-5.5"')
      expect(written).toContain('notes = "keep"')
      expect(written).toContain('trust_level = "trusted"')
      expect(written).not.toContain('trust_level = "untrusted"')
      expect(runtimeWritten).toContain('sandbox_mode = "workspace-write"')
      expect(runtimeWritten).toContain('notes = "keep-runtime"')
      expect(runtimeWritten).toContain('trust_level = "trusted"')
      expect(runtimeWritten).not.toContain('trust_level = "untrusted"')
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})

function escapeTomlBasicString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}
