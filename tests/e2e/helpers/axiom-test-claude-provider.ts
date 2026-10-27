import { AXIOM_TEST_PROVIDER_SOURCE } from './axiom-test-provider'
import { AXIOM_T01_FIXTURE_FILES } from './axiom-t01-fixture'

export const AXIOM_TEST_CLAUDE_VERSION = '2.1.280'
export const AXIOM_TEST_CLAUDE_MODEL = 'sonnet'
export const AXIOM_TEST_CLAUDE_DENIED_TOOLS = [
  'WebFetch',
  'WebSearch',
  'Agent',
  'Task',
  'TaskOutput',
  'TaskStop',
  'SendMessage',
  'TeamCreate',
  'TeamDelete',
  'Computer',
  'EnterWorktree',
  'ExitWorktree',
  'CronCreate',
  'CronDelete'
]
export const AXIOM_TEST_CLAUDE_ENV = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_AUTOUPDATER: '1',
  DISABLE_TELEMETRY: '1',
  DISABLE_ERROR_REPORTING: '1',
  DISABLE_BUG_COMMAND: '1',
  CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1'
}

/** No Agent SDK handshake: Planner exercises Orca's existing terminal fallback. */
export const AXIOM_TEST_CLAUDE_PROVIDER_SOURCE = `
if (process.argv[2] === '--version') {
  process.stdout.write('${AXIOM_TEST_CLAUDE_VERSION} (Claude Code)\\n')
  process.exit(0)
}
if (process.argv.includes('--input-format')) {
  process.stderr.write('error: unsupported SDK --input-format\\n')
  process.exit(2)
}
if (process.argv.slice(2).includes('-p')) {
  const assert = require('node:assert/strict')
  const { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } = require('node:fs')
  const { createHash } = require('node:crypto')
  const path = require('node:path')
  const argv = process.argv.slice(2)
  const flag = name => argv[argv.indexOf(name) + 1]
  const settingsPath = flag('--settings')
  const attemptDir = path.dirname(settingsPath)
  const mcpPath = flag('--mcp-config')
  const prompt = readFileSync(0, 'utf8')
  const attemptId = prompt.match(/^Attempt: (\\S+)/m)?.[1]
  const missionId = prompt.match(/^Mission: (\\S+)/m)?.[1]
  const taskId = prompt.match(/^Task: (\\S+)/m)?.[1]
  assert.ok(attemptId && missionId && taskId, 'Missing headless prompt attribution')
  for (const pin of ['-p', '--verbose', '--setting-sources=', '--strict-mcp-config']) assert.ok(argv.includes(pin), 'Missing pin ' + pin)
  assert.equal(flag('--output-format'), 'stream-json')
  assert.equal(flag('--permission-mode'), 'acceptEdits')
  assert.equal(flag('--permission-prompts'), 'none')
  assert.equal(flag('--model'), '${AXIOM_TEST_CLAUDE_MODEL}')
  assert.equal(flag('--effort'), 'medium')
  assert.ok(!argv.some(arg => /max-turns|dangerously|bypassPermissions/.test(arg)))
  assert.equal(settingsPath, path.join(attemptDir, 'claude-settings.json'))
  assert.equal(mcpPath, path.join(attemptDir, 'claude-mcp.json'))
  assert.equal(statSync(settingsPath).mode & 0o777, 0o600)
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  const denied = ${JSON.stringify(AXIOM_TEST_CLAUDE_DENIED_TOOLS)}
  for (const tool of denied) {
    assert.ok(flag('--disallowedTools').split(',').includes(tool), 'Missing disallowed tool ' + tool)
    assert.ok(settings.permissions.deny.includes(tool), 'Missing denied tool ' + tool)
  }
  for (const tool of ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash']) assert.ok(settings.permissions.allow.includes(tool), 'Missing allowed tool ' + tool)
  assert.deepEqual(settings.sandbox, {
    enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
    network: { allowedDomains: [], allowLocalBinding: false, strictAllowlist: true },
    filesystem: { allowWrite: [process.cwd(), attemptDir] }
  })
  assert.equal(settings.syncClaudeAiSkills, false)
  assert.equal(settings.syncClaudeAiPlugins, false)
  assert.deepEqual(settings.enabledPlugins, {})
  assert.ok(!('hooks' in settings) && !('env' in settings))
  assert.deepEqual(JSON.parse(readFileSync(mcpPath, 'utf8')), { mcpServers: {} })
  for (const [key, value] of Object.entries(${JSON.stringify(AXIOM_TEST_CLAUDE_ENV)})) assert.equal(process.env[key], value)
  assert.ok(process.env.CLAUDE_CONFIG_DIR?.endsWith(path.join('claude-profiles', 'e2e-claude', 'home')))
  appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({
    provider: 'claude', cwd: process.cwd(), attemptId, taskId,
    terminalHandle: process.env.ORCA_TERMINAL_HANDLE, paneKey: process.env.ORCA_PANE_KEY,
    preambleSha256: createHash('sha256').update(prompt).digest('hex'), preambleBytes: Buffer.byteLength(prompt),
    argv, promptPath: path.join(attemptDir, 'prompt.md'), settings, mcp: { mcpServers: {} },
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR
  }) + '\\n')
  const emit = event => process.stdout.write(JSON.stringify(event) + '\\n')
  const sessionId = 'fixture-' + attemptId
  emit({ type: 'system', subtype: 'init', session_id: sessionId, claude_code_version: '${AXIOM_TEST_CLAUDE_VERSION}',
    model: '${AXIOM_TEST_CLAUDE_MODEL}', permissionMode: 'acceptEdits', tools: settings.permissions.allow,
    mcp_servers: [], skills: [], plugins: [], apiKeySource: 'none' })
  async function completeFixture() {
    while (existsSync(process.env.AXIOM_E2E_LEDGER + '.hold')) await new Promise(resolve => setTimeout(resolve, 50))
    const files = ${JSON.stringify(AXIOM_T01_FIXTURE_FILES)}
    for (const [file, text] of Object.entries(files)) writeFileSync(path.join(process.cwd(), file), text, { flag: 'wx' })
    const artifacts = path.join(process.cwd(), '.axiom', 'artifacts')
    mkdirSync(artifacts, { recursive: true })
    const summary = 'Frozen fixture T01: Sprint entity and validation'
    const reportText = '# Worker submission\\n\\n' + summary + '\\nmission: ' + missionId + '\\ntaskId: ' + taskId + '\\nattemptId: ' + attemptId + '\\n'
    writeFileSync(path.join(artifacts, 'REPORT.md'), reportText)
    const report = { summary, checksRun: [{ command: 'pnpm run verify:full', result: 'skipped', note: 'Host independent verification runs the frozen fixture gate.' }],
      artifacts: [{ path: '.axiom/artifacts/REPORT.md', kind: 'worker_report', mediaType: 'text/markdown' }],
      limitations: ['Deterministic fake provider; no live Claude invocation'], risks: [], questions: [], followUps: [] }
    emit({ type: 'assistant', session_id: sessionId, message: { role: 'assistant', content: [{ type: 'text', text: summary }] } })
    emit({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, num_turns: 1,
      result: reportText + '\\n\`\`\`json\\n' + JSON.stringify(report) + '\\n\`\`\`\\n',
      usage: { input_tokens: 100, cache_read_input_tokens: 40, cache_creation_input_tokens: 0, output_tokens: 25 },
      modelUsage: { '${AXIOM_TEST_CLAUDE_MODEL}': { inputTokens: 100, outputTokens: 25, cacheReadInputTokens: 40, costUSD: 0.001 } },
      total_cost_usd: 0.001, permission_denials: [] })
  }
  void completeFixture().then(() => process.exit(0)).catch(error => {
    emit({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: [error.message] })
    process.exit(1)
  })
} else {
${AXIOM_TEST_PROVIDER_SOURCE.replaceAll('Codex Ready', 'Claude Ready').replaceAll('Codex Working', 'Claude Working').replace('OpenAI Codex', 'Claude Code')}
}
`
