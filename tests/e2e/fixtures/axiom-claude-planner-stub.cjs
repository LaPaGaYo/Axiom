// Mission Planner stand-in for Claude's SDK stream-json protocol. No permission prompts:
// the printed, permission-allowed CLI recipe is the only mutation this fixture executes.
const { randomUUID } = require('node:crypto')
const { appendFileSync, readFileSync } = require('node:fs')
const { spawn, spawnSync } = require('node:child_process')
const path = require('node:path')
const readline = require('node:readline')

const args = process.argv.slice(2)
const record = (entry) => appendFileSync(process.env.AXIOM_E2E_LEDGER, `${JSON.stringify(entry)}\n`)
if (args[0] === '--planner-submit') {
  // As in the Codex fixture, a detached reporter survives the host stopping the Planner.
  const [attemptId, recipe] = args.slice(1)
  const result = spawnSync('/bin/sh', ['-c', recipe], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    timeout: 30_000
  })
  let response
  try {
    response = JSON.parse(result.stdout)
  } catch {
    response = { ok: false }
  }
  record({ kind: 'proposal', attemptId, recipe, status: result.status, response })
  process.exit(result.status === 0 && response.ok ? 0 : 1)
}
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
  if (joined !== undefined) {return joined.slice(name.length + 1)}
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const sessionId = argValue('--session-id') ?? randomUUID()
const model = argValue('--model') ?? 'claude-fixture-default'
const effort = argValue('--effort') ?? 'high'
const settingsPath = argValue('--settings')
const settings = settingsPath ? JSON.parse(readFileSync(settingsPath, 'utf8')) : null
const write = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`)
const models = [{ value: model, displayName: 'Fixture default', description: '' }]
let initSent = false
let submitted = false
let pending = false
let inputEnded = false

function proposalRecipe(preamble) {
  const command = preamble.match(
    /^axiom plan propose --mission ([\w-]+) --attempt ([\w-]+) --file \/dev\/stdin --json <<'AXIOM_PLAN_JSON'$/m
  )
  const goalRevisionId = preamble.match(/"goalRevisionId":\s*"([^"]+)"/)?.[1]
  if (!command || !goalRevisionId) {throw new Error('Missing Planner stdin proposal recipe')}
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
  return {
    attemptId: command[2],
    recipe: `${command[0]}\n${JSON.stringify(proposal)}\nAXIOM_PLAN_JSON`
  }
}

function startTurn(frame) {
  write({ ...frame, isReplay: true })
  if (submitted) {return}
  submitted = true
  const content = frame.message?.content
  const preamble =
    typeof content === 'string'
      ? content
      : (content ?? [])
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
  const { attemptId, recipe } = proposalRecipe(preamble)
  record({ kind: 'planner_preamble', attemptId, recipe })
  pending = true
  const reporter = spawn(process.execPath, [__filename, '--planner-submit', attemptId, recipe], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: 'ignore'
  })
  reporter.once('error', fail)
  reporter.once('exit', (code) => {
    pending = false
    const result = code === 0 ? 'Fixture PlanProposal submitted.' : 'Fixture proposal failed.'
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
      subtype: code === 0 ? 'success' : 'error_during_execution',
      is_error: code !== 0,
      terminal_reason: 'completed',
      result,
      num_turns: 1,
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
      permission_denials: []
    })
    // An SDK multi-turn session stays idle until the host closes it.
    if (inputEnded) {process.exit(code === 0 ? 0 : 1)}
  })
  reporter.unref()
}

function handle(frame) {
  if (frame.type === 'user') {return startTurn(frame)}
  if (frame.type !== 'control_request') {return}
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
      argv: args,
      settingsPath,
      settings,
      // This SDK generation puts settingSources on argv, not in initialize. Record absence.
      initialize: {
        settingSources: frame.request.settingSources ?? null,
        skills: frame.request.skills ?? null
      },
      env: Object.fromEntries(
        [
          'CLAUDE_CONFIG_DIR',
          'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
          'CLAUDE_CODE_DISABLE_BUNDLED_SKILLS',
          'DISABLE_AUTOUPDATER',
          'DISABLE_TELEMETRY',
          'DISABLE_ERROR_REPORTING',
          'DISABLE_BUG_COMMAND'
        ].map((key) => [key, process.env[key] ?? null])
      )
    })
    write({
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
      uuid: randomUUID(),
      model,
      cwd: process.cwd(),
      tools: [],
      mcp_servers: [],
      skills: [],
      plugins: [],
      permissionMode: 'default',
      slash_commands: [],
      apiKeySource: 'none',
      output_style: 'default'
    })
  }
}
function fail(error) {
  record({ kind: 'error', message: error.message })
  process.exit(1)
}
const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  try {
    if (line.trim()) {handle(JSON.parse(line))}
  } catch (error) {
    fail(error)
  }
})
input.on('close', () => {
  inputEnded = true
  if (!pending) {process.exit(0)}
})
