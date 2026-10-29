// Mission Planner stand-in for Claude's SDK stream-json protocol. No permission prompts:
// the configured Axiom MCP server is the only mutation channel.
const { randomUUID } = require('node:crypto')
const { appendFileSync, readFileSync } = require('node:fs')
const { spawn } = require('node:child_process')
const path = require('node:path')
const readline = require('node:readline')

const args = process.argv.slice(2)
const record = (entry) => appendFileSync(process.env.AXIOM_E2E_LEDGER, `${JSON.stringify(entry)}\n`)
if (args.includes('--version') || args.includes('-v')) {
  process.stdout.write('2.1.280 (Claude Code)\n')
  process.exit(0)
}
if (args.includes('--help')) {
  process.stdout.write(
    '--input-format stream-json\n--output-format stream-json\n--settings <file>\n--setting-sources <sources>\n'
  )
  process.exit(0)
}

function argValue(name) {
  const joined = args.find((arg) => arg.startsWith(`${name}=`))
  if (joined !== undefined) {
    return joined.slice(name.length + 1)
  }
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const sessionId = argValue('--session-id') ?? randomUUID()
const model = argValue('--model') ?? 'claude-fixture-default'
const effort = argValue('--effort') ?? 'high'
const managedSettingsArg = argValue('--managed-settings')
const managedSettings = managedSettingsArg ? JSON.parse(managedSettingsArg) : null
const settingsPath = argValue('--settings')
const settings = settingsPath ? JSON.parse(readFileSync(settingsPath, 'utf8')) : null
const mcpServers = JSON.parse(argValue('--mcp-config') ?? '{}').mcpServers ?? {}
const strictMcpConfig = args.includes('--strict-mcp-config')
const safeMcpServers = Object.fromEntries(
  Object.entries(mcpServers).map(([name, config]) => [
    name,
    {
      type: config.type,
      command: config.command,
      args: config.args,
      envKeys: Object.keys(config.env ?? {}).sort()
    }
  ])
)
// SDK argv embeds env values in --mcp-config. The ledger stores only the safe shape.
const safeMcpConfig = JSON.stringify({ mcpServers: safeMcpServers })
const safeArgs = args.map((arg, index) => {
  if (arg.startsWith('--mcp-config=')) {
    return `--mcp-config=${safeMcpConfig}`
  }
  return args[index - 1] === '--mcp-config' ? safeMcpConfig : arg
})
const write = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`)
const models = [{ value: model, displayName: 'Fixture default', description: '' }]
let initSent = false
let submitted = false
let pending = false
let inputEnded = false

function fixtureProposal(preamble) {
  const goalRevisionId = preamble.match(/"goalRevisionId":\s*"([^"]+)"/)?.[1]
  if (!preamble.includes('plan_propose') || !goalRevisionId) {
    throw new Error('Missing Planner MCP proposal contract')
  }
  const { tasks } = JSON.parse(
    readFileSync(path.join(process.cwd(), 'scenarios', 'goal', 'decomposition.json'), 'utf8')
  )
  const proposal = {
    goalRevisionId,
    milestones: [{ id: 'm1', title: 'M1 exit', exitCriteria: ['all 12 Tasks integrated'] }],
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      objective: task.title,
      scope: { allowedPaths: task.scope },
      acceptanceCriteria: task.acceptance.map((entry) => entry.must),
      requiredEvidence: [...new Set(task.acceptance.map((entry) => entry.command))],
      risk: 'low',
      retryPolicy: { maxAttempts: 2 },
      kind: 'task',
      milestoneId: 'm1'
    })),
    edges: tasks.flatMap((task) =>
      task.dependsOn.map((dep) => ({
        fromTaskId: dep,
        toTaskId: task.id,
        readinessThreshold: 'INTEGRATED'
      }))
    ),
    risks: []
  }
  return proposal
}

async function propose(preamble) {
  const config = mcpServers.axiom
  if (!strictMcpConfig || !config || !path.isAbsolute(config.command)) {
    throw new Error('Missing strict Axiom MCP server')
  }
  const attemptId = config.args[config.args.indexOf('--attempt') + 1]
  const child = spawn(config.command, config.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...config.env },
    stdio: ['pipe', 'pipe', 'ignore']
  })
  const responses = new Map()
  let nextId = 0
  const lines = readline.createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    try {
      const frame = JSON.parse(line)
      const pending = responses.get(frame.id)
      if (pending) {
        responses.delete(frame.id)
        if (frame.error) {
          pending.reject(new Error('MCP request failed'))
        } else {
          pending.resolve(frame.result)
        }
      }
    } catch {
      fail(new Error('Invalid MCP response frame'))
    }
  })
  const rejectPending = () => {
    for (const pending of responses.values()) {
      pending.reject(new Error('MCP server ended'))
    }
    responses.clear()
  }
  child.once('error', rejectPending)
  child.once('exit', rejectPending)
  const send = (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`)
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => {
        responses.delete(id)
        reject(new Error('MCP request timed out'))
      }, 25000)
      responses.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      send({ jsonrpc: '2.0', id, method, params })
    })
  try {
    await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'axiom-planner-fixture', version: '1' }
    })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const listing = await request('tools/list', {})
    const names = listing.tools.map((tool) => tool.name)
    record({ kind: 'tools/list', attemptId, tools: names })
    if (!names.includes('plan_propose')) {
      throw new Error('Missing plan_propose tool')
    }
    if (process.env.AXIOM_E2E_PLANNER_NO_PROPOSAL === '1') {
      return
    }
    const result = await request('tools/call', {
      name: 'plan_propose',
      arguments: { proposal: fixtureProposal(preamble) }
    })
    const response = JSON.parse(result.content.find((item) => item.type === 'text').text)
    record({ kind: 'proposal', attemptId, response, isError: result.isError ?? false })
    if (result.isError || !response.ok) {
      throw new Error('Proposal rejected')
    }
  } finally {
    child.stdin.end()
  }
}

async function startTurn(frame) {
  write({ ...frame, isReplay: true })
  if (submitted) {
    return
  }
  submitted = true
  pending = true
  const content = frame.message?.content
  const preamble =
    typeof content === 'string'
      ? content
      : (content ?? [])
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
  let success = true
  try {
    await propose(preamble)
  } catch {
    success = false
  }
  pending = false
  const result = success ? 'Fixture Planner turn ended.' : 'Fixture proposal failed.'
  write({
    type: 'assistant',
    uuid: randomUUID(),
    session_id: sessionId,
    parent_tool_use_id: null,
    message: {
      id: randomUUID(),
      role: 'assistant',
      model,
      content: [{ type: 'text', text: result }]
    }
  })
  write({
    type: 'result',
    uuid: randomUUID(),
    session_id: sessionId,
    subtype: success ? 'success' : 'error_during_execution',
    is_error: !success,
    terminal_reason: 'completed',
    result,
    num_turns: 1,
    total_cost_usd: 0,
    usage: { input_tokens: 1, output_tokens: 1 },
    permission_denials: []
  })
  write({ type: 'system', subtype: 'session_state_changed', state: 'idle', session_id: sessionId })
  if (inputEnded) {
    process.exit(success ? 0 : 1)
  }
}

function handle(frame) {
  if (frame.type === 'user') {
    void startTurn(frame).catch(fail)
    return
  }
  if (frame.type !== 'control_request') {
    return
  }
  const subtype = frame.request?.subtype
  const response =
    subtype === 'initialize'
      ? {
          commands: [],
          models,
          account: {},
          output_style: 'default',
          available_output_styles: ['default']
        }
      : subtype === 'get_settings'
        ? { effective: { ...settings, effortLevel: effort }, applied: { model, effort } }
        : subtype === 'list_models'
          ? { models }
          : {}
  write({
    type: 'control_response',
    response: { subtype: 'success', request_id: frame.request_id, response }
  })
  if (subtype === 'initialize' && !initSent) {
    initSent = true
    record({
      kind: 'planner_launch',
      sessionId,
      argv: safeArgs,
      mcpServers: safeMcpServers,
      strictMcpConfig,
      settingsPath,
      settings,
      managedSettings,
      // This SDK generation puts settingSources on argv, not in initialize. Record absence.
      initialize: {
        settingSources: frame.request.settingSources ?? null,
        skills: frame.request.skills ?? null
      },
      // Allowlisted Planner process env only; inherited proxies are masked (M3-08f / M3-08g).
      env: {
        ...Object.fromEntries(
          [
            'CLAUDE_CONFIG_DIR',
            'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
            'CLAUDE_CODE_DISABLE_BUNDLED_SKILLS',
            'DISABLE_AUTOUPDATER',
            'DISABLE_TELEMETRY',
            'DISABLE_ERROR_REPORTING',
            'DISABLE_BUG_COMMAND'
          ].map((key) => [key, process.env[key] ?? null])
        ),
        ...Object.fromEntries(
          [
            'HTTPS_PROXY',
            'HTTP_PROXY',
            'ALL_PROXY',
            'https_proxy',
            'http_proxy',
            'all_proxy',
            'NO_PROXY',
            'no_proxy'
          ].map((key) => {
            const value = process.env[key] ?? null
            return [
              key,
              value &&
              key.toLowerCase() !== 'no_proxy' &&
              !/^http:\/\/(?:127\.0\.0\.1|localhost):[0-9]+\/?$/.test(value)
                ? '[inherited]'
                : value
            ]
          })
        )
      }
    })
    write({
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
      uuid: randomUUID(),
      model,
      cwd: process.cwd(),
      tools: [],
      mcp_servers: [{ name: 'axiom', status: 'connected' }],
      skills: [],
      plugins: [],
      permissionMode: 'default',
      slash_commands: [],
      apiKeySource: 'none',
      output_style: 'default'
    })
  }
}
function fail() {
  record({ kind: 'error', message: 'Planner fixture failed' })
  process.exit(1)
}
const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  try {
    if (line.trim()) {
      handle(JSON.parse(line))
    }
  } catch (error) {
    fail(error)
  }
})
input.on('close', () => {
  inputEnded = true
  if (!pending) {
    process.exit(0)
  }
})
