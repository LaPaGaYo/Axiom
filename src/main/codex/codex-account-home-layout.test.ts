import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { parse } from 'smol-toml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { layoutCodexAccountHome } from './codex-account-home-layout'
import { computeOrcaCodexHookHashes } from './codex-hook-definition'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'axiom-account-layout-'))
  const homePath = join(root, 'accounts', 'a'.repeat(80), 'home')
  const userHomePath = join(root, 'user')
  const systemHomePath = join(userHomePath, '.codex')
  mkdirSync(homePath, { recursive: true })
  mkdirSync(systemHomePath, { recursive: true })
  vi.stubEnv('ORCA_USER_DATA_PATH', join(root, 'data'))
  return { root, homePath, userHomePath, systemHomePath, allowlist: { skills: [], mcpServers: [] } }
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
afterEach(() => vi.unstubAllEnvs())

describe('layoutCodexAccountHome', () => {
  it.each(['absolute', 'relative', 'dangling'] as const)(
    'unlinks only owned resource links (%s)',
    (kind) => {
      const input = fixture()
      const source = join(input.systemHomePath, kind === 'dangling' ? 'missing' : 'skills')
      mkdirSync(join(input.systemHomePath, 'skills'), { recursive: true })
      writeFileSync(join(input.systemHomePath, 'skills', 'keep'), 'untouched')
      symlinkSync(
        kind === 'relative' ? relative(input.homePath, source) : source,
        join(input.homePath, 'skills')
      )
      mkdirSync(join(input.homePath, 'plugins'))
      writeFileSync(join(input.homePath, 'AGENTS.md'), 'account-owned')
      const elsewhere = join(input.root, '.codex-other')
      mkdirSync(elsewhere)
      symlinkSync(elsewhere, join(input.homePath, 'prompts'))
      writeFileSync(join(input.homePath, 'auth.json'), 'codex-owned')
      mkdirSync(join(input.homePath, 'sessions'))
      const result = layoutCodexAccountHome(input)
      expect(result.removedLinks).toEqual(['skills'])
      expect(readdirSync(input.homePath)).not.toContain('skills')
      expect(readFileSync(join(input.systemHomePath, 'skills', 'keep'), 'utf8')).toBe('untouched')
      expect(lstatSync(join(input.homePath, 'plugins')).isDirectory()).toBe(true)
      expect(lstatSync(join(input.homePath, 'prompts')).isSymbolicLink()).toBe(true)
      expect(readFileSync(join(input.homePath, 'AGENTS.md'), 'utf8')).toBe('account-owned')
      expect(readFileSync(join(input.homePath, 'auth.json'), 'utf8')).toBe('codex-owned')
      expect(lstatSync(join(input.homePath, 'sessions')).isDirectory()).toBe(true)
    }
  )

  it('replaces mirrored settings and user hooks while preserving project trust and Orca approvals', () => {
    const input = fixture()
    const command = 'sh /example/.orca/agent-hooks/codex-hook.sh'
    const source = join(input.homePath, 'hooks.json')
    const key = `${source}:stop:1:1`
    const approvedHash = computeOrcaCodexHookHashes(command).stop
    writeFileSync(
      source,
      JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: 'command', command: 'user-first' }] },
            {
              hooks: [
                { type: 'command', command: 'user-second' },
                { type: 'command', command, timeout: 10 }
              ]
            }
          ],
          SessionStart: [{ hooks: [{ type: 'command', command: 'user-start' }] }]
        }
      })
    )
    writeFileSync(
      join(input.homePath, 'config.toml'),
      `${[
        'model_provider = "private"',
        'model = "custom"',
        '[profiles.fast]',
        'model = "custom"',
        '[mcp_servers.secret]',
        'command = "secret"',
        '[plugins.x]',
        'enabled = true',
        '[marketplaces.x]',
        'source = "custom"',
        '[tui]',
        'theme = "custom"',
        '[features]',
        'hooks = false',
        'apps = true',
        '[projects."/repository"]',
        'trust_level = "trusted"',
        `[hooks.state.${JSON.stringify(key)}]`,
        `trusted_hash = ${JSON.stringify(approvedHash)}`,
        'enabled = true',
        `[hooks.state.${JSON.stringify(`${source}:stop:0:0`)}]`,
        'trusted_hash = "user-hash"',
        'enabled = true'
      ].join('\n')}\n`
    )
    writeFileSync(join(input.homePath, '.orca-config-settings-baseline.json'), '{}')
    const result = layoutCodexAccountHome(input)
    const config = readFileSync(join(input.homePath, 'config.toml'), 'utf8')
    const newKey = `${source}:stop:0:0`
    expect(parse(config)).toEqual({
      features: { apps: false, plugins: false, daemon_auto_start: false },
      projects: { '/repository': { trust_level: 'trusted' } },
      hooks: { state: { [newKey]: { trusted_hash: approvedHash, enabled: true } } }
    })
    expect(config).toContain('Axiom (D83)')
    expect(result.configSha256).toBe(sha256(config))
    expect(result.hookApprovals).toEqual([newKey])
    expect(JSON.parse(readFileSync(source, 'utf8'))).toEqual({
      hooks: { Stop: [{ hooks: [{ type: 'command', command, timeout: 10 }] }] }
    })
    expect(readdirSync(input.homePath)).not.toContain('.orca-config-settings-baseline.json')
    expect(statSync(join(input.homePath, 'config.toml')).mode & 0o777).toBe(0o600)
    expect(layoutCodexAccountHome(input)).toEqual(result)
  })

  it('copies allowlisted MCP tables verbatim, disables only unlisted user skills, and is stable', () => {
    const input = fixture()
    const server =
      '[mcp_servers."docs.api"]\ncommand = "docs" # keep this\n[mcp_servers."docs.api".env]\nTOKEN = "fixture-only"\n'
    writeFileSync(
      join(input.systemHomePath, 'config.toml'),
      `model = "ignored"\n${server}[mcp_servers.other]\ncommand = "ignored"\n`
    )
    for (const name of ['alpha', 'beta', 'allowed']) {
      const directory = join(input.userHomePath, '.agents', 'skills', name)
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'SKILL.md'), `# ${name}`)
    }
    mkdirSync(join(input.userHomePath, '.agents', 'skills', 'empty'))
    const settings = {
      ...input,
      allowlist: { skills: ['allowed'], mcpServers: ['docs.api', 'missing'] }
    }
    const result = layoutCodexAccountHome(settings)
    const configPath = join(input.homePath, 'config.toml')
    const config = readFileSync(configPath, 'utf8')
    expect(config).toContain(server)
    expect(config).not.toContain('ignored')
    expect(result.missingMcpServers).toEqual(['missing'])
    expect(result.mcpServers).toEqual([{ name: 'docs.api', sha256: sha256(server) }])
    const skill = (name: string) => join(input.userHomePath, '.agents', 'skills', name, 'SKILL.md')
    expect(result.disabledSkills).toEqual([skill('alpha'), skill('beta')])
    expect(result.enabledUserSkills).toEqual([skill('allowed')])
    expect(parse(config).skills).toEqual({
      config: result.disabledSkills.map((path) => ({ path, enabled: false }))
    })
    utimesSync(configPath, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'))
    const previous = statSync(configPath).mtimeMs
    expect(layoutCodexAccountHome(settings)).toEqual(result)
    expect(statSync(configPath).mtimeMs).toBe(previous)
    expect(readFileSync(configPath, 'utf8')).toBe(config)
  })

  it.each(['config.toml', 'hooks.json'])(
    'refuses to read or write through a %s symlink',
    (file) => {
      const input = fixture()
      const target = join(input.systemHomePath, file)
      writeFileSync(target, file === 'hooks.json' ? '{}' : 'model = "kept"\n')
      symlinkSync(target, join(input.homePath, file))
      const previous = statSync(target).mtimeMs
      expect(() => layoutCodexAccountHome(input)).toThrow()
      expect(statSync(target).mtimeMs).toBe(previous)
      expect(lstatSync(join(input.homePath, file)).isSymbolicLink()).toBe(true)
    }
  )

  it('disables user skills exposed by links without reading their contents', () => {
    const input = fixture()
    const skills = join(input.userHomePath, '.agents', 'skills')
    const target = join(input.root, 'linked-skill')
    mkdirSync(target)
    writeFileSync(join(target, 'SKILL.md'), '# linked skill')
    mkdirSync(join(skills, 'linked-file'), { recursive: true })
    symlinkSync(target, join(skills, 'linked-directory'))
    symlinkSync(join(target, 'SKILL.md'), join(skills, 'linked-file', 'SKILL.md'))

    expect(layoutCodexAccountHome(input).disabledSkills).toEqual([
      join(skills, 'linked-directory', 'SKILL.md'),
      join(skills, 'linked-file', 'SKILL.md')
    ])
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe('# linked skill')
  })
})
