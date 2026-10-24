import { FAKE_AGENT_PASTE_END_SCANNER_SOURCE } from './fake-agent-paste-end-scanner'

/** D49: capture the preamble; the submit spec supplies a compiled CLI to run the frozen stub. */
export const AXIOM_TEST_PROVIDER_SOURCE = `
const { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const path = require('node:path')
const os = require('node:os')
if (process.argv.slice(2).includes('app-server')) {
  process.stderr.write("error: unrecognized subcommand 'app-server'\\n")
  process.exit(2)
}
${FAKE_AGENT_PASTE_END_SCANNER_SOURCE}
function cli(args) {
  const result = spawnSync(process.execPath, [process.env.ORCA_E2E_CLI_ENTRY, ...args, '--json'], {
    cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 30000
  })
  let response
  try { response = JSON.parse(result.stdout) } catch { response = { ok: false } }
  return { status: result.status, response }
}
async function submitFixture(attemptId, missionId, taskId) {
  const deadline = Date.now() + 60000
  // Preamble acknowledgment precedes the launcher's binding CAS. Wait for that public identity.
  while (!cli(['attempt', 'show', '--attempt', attemptId]).response.ok) {
    if (Date.now() >= deadline) throw new Error('Attempt binding timeout')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const crashMarker = process.env.AXIOM_E2E_LEDGER + '.crash-' + taskId
  if (existsSync(crashMarker)) {
    rmSync(crashMarker)
    appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({ kind: 'crash', attemptId, taskId }) + '\\n')
    const crashed = spawnSync(process.execPath, ['scenarios/stub-worker/worker.mjs', '--scenario', 'agent-crash', '--mode', 'crash', '--cwd', process.cwd()], {
      cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 60000
    })
    process.exit(crashed.status || 1)
  }
  const scenarioMarker = process.env.AXIOM_E2E_LEDGER + '.scenario-' + taskId
  const scenario = existsSync(scenarioMarker) ? readFileSync(scenarioMarker, 'utf8').trim() : 'retry'
  if (!['retry', 'deterministic-failure', 'agent-crash', 'scope-violation', 'secret-line'].includes(scenario)) throw new Error('Unknown fixture scenario')
  // Keep both the Worker Artifact and protocol envelope outside the Candidate snapshot.
  const temp = mkdtempSync(path.join(os.tmpdir(), 'axiom-submit-report-'))
  try {
    const command = ['scenarios/stub-worker/worker.mjs', '--scenario', scenario, '--attempt', '1', '--mode', 'succeed', '--cwd', process.cwd()]
    const started = Date.now()
    const providerOnly = scenario === 'scope-violation' || scenario === 'secret-line'
    let reportText
    if (providerOnly) {
      if (scenario === 'scope-violation') {
        appendFileSync(path.join(process.cwd(), 'README.md'), '\\n<!-- axiom e2e scope probe -->\\n')
      } else {
        const token = 'gh' + 'p_' + 'Z'.repeat(36)
        appendFileSync(path.join(process.cwd(), 'src', 'services', 'csv.ts'), "export const AXIOM_E2E_PROBE = '" + token + "'\\n")
      }
      reportText = 'Provider diff-gate probe: ' + scenario + '\\n'
    } else {
      const stub = spawnSync(process.execPath, command, { cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 60000 })
      if (stub.status !== 0) throw new Error('Fixture stub failed')
      const stubReport = path.join(process.cwd(), 'REPORT.md')
      reportText = readFileSync(stubReport, 'utf8')
      rmSync(stubReport)
    }
    // Attribution prevents Artifact deduplication from reusing another Task's related metadata.
    reportText += '\\nmission: ' + missionId + '\\ntaskId: ' + taskId + '\\nattemptId: ' + attemptId + '\\n'
    const reportPath = path.join(temp, 'REPORT.md')
    writeFileSync(reportPath, reportText)
    const artifact = cli(['mission', 'artifact', 'put', '--mission', missionId, '--kind', 'worker_report', '--file', reportPath, '--related', taskId])
    appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({ kind: 'artifact', attemptId, ...artifact }) + '\\n')
    if (!artifact.response.ok) throw new Error('Artifact put failed')
    const artifactId = artifact.response.result.artifact.id
    const changed = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' })
    if (changed.status !== 0) throw new Error('Fixture diff failed')
    const report = {
      summary: 'D49 ' + scenario + ' scenario attempt 1 succeeded',
      filesChanged: changed.stdout.trim().split(/\\r?\\n/).filter(Boolean),
      checksRun: [{ command: providerOnly ? 'provider scenario ' + scenario : 'node ' + command.join(' '), result: 'pass', durationMs: Date.now() - started },
        { command: 'fixture verification', result: 'skipped', note: 'Stub Worker; independent verification is queued for M3.' }],
      artifacts: [artifactId], limitations: ['Fixture stub; no independent verification run by Worker'],
      risks: ['Write scope is enforced during M3 verification'], questions: [], followUps: ['VerificationService dequeues QUEUED']
    }
    const file = path.join(temp, 'report.json')
    writeFileSync(file, JSON.stringify(report))
    const submission = cli(['attempt', 'submit', '--attempt', attemptId, '--report', file])
    appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({ kind: 'submission', attemptId, ...submission }) + '\\n')
    if (!submission.response.ok) throw new Error('Attempt submit failed')
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}
function fixtureProposal(tasks, goalRevisionId) {
  return {
    goalRevisionId,
    milestones: [{ id: 'm1', title: 'M1 exit', exitCriteria: ['all 12 Tasks integrated'] }],
    tasks: tasks.map(task => ({
      id: task.id, title: task.title, objective: task.title,
      scope: { allowedPaths: task.scope },
      acceptanceCriteria: task.acceptance.map(entry => entry.must),
      requiredEvidence: [...new Set(task.acceptance.map(entry => entry.command))],
      risk: 'low', retryPolicy: { maxAttempts: 2 }, kind: 'task', milestoneId: 'm1'
    })),
    edges: tasks.flatMap(task => task.dependsOn.map(dep => ({
      fromTaskId: dep, toTaskId: task.id, readinessThreshold: 'INTEGRATED'
    }))),
    risks: []
  }
}
function submitPlannerFixture(attemptId, missionId, goalRevisionId) {
  const decomposition = JSON.parse(readFileSync(path.join(process.cwd(), 'scenarios', 'goal', 'decomposition.json'), 'utf8'))
  const temp = mkdtempSync(path.join(os.tmpdir(), 'axiom-plan-proposal-'))
  try {
    const file = path.join(temp, 'proposal.json')
    writeFileSync(file, JSON.stringify(fixtureProposal(decomposition.tasks, goalRevisionId)))
    const result = cli(['plan', 'propose', '--mission', missionId, '--attempt', attemptId, '--file', file])
    appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({ kind: 'proposal', attemptId, ...result }) + '\\n')
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}
// Proposal settlement stops the provider before replying. A short-lived detached reporter
// finishes recording that response even after the provider's PTY process group is closed.
if (process.argv[2] === '--planner-submit') {
  try {
    submitPlannerFixture(...process.argv.slice(3))
    process.exit(0)
  } catch (error) {
    appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({ kind: 'error', attemptId: process.argv[3], message: error.message }) + '\\n')
    process.exit(1)
  }
}
let delivered = ''
let recorded = false
process.stdout.write('\\u001b]0;Codex Ready\\u0007OpenAI Codex\\nmodel: e2e\\ndirectory: e2e\\n')
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  const input = chunk.toString()
  delivered += input
  const scan = scanFakeAgentPasteEnd(fakeAgentPasteEndTail, input)
  fakeAgentPasteEndTail = scan.tail
  if (scan.pasteEndOffset !== null) process.stdout.write('\\x1b[?25h')
  if (recorded) return
  fakeAgentMaybeAck(scan, input, mode => {
    const begin = delivered.indexOf('\\x1b[200~')
    const end = delivered.indexOf('\\x1b[201~')
    const preamble = begin >= 0 && end >= 0 ? delivered.slice(begin + 6, end) : delivered
    const attemptId = preamble.match(/--attempt (\\S+)/)?.[1]
    const artifactRecipe = preamble.match(/axiom mission artifact put --mission (\\S+) --kind <kind> --file <path> --related (\\S+)/)
    if (!attemptId || mode !== 'bracketed') {
      process.stdout.write('PASTE_PROTOCOL_ERROR\\n')
      return
    }
    recorded = true
    appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({
      cwd: process.cwd(), attemptId, terminalHandle: process.env.ORCA_TERMINAL_HANDLE, paneKey: process.env.ORCA_PANE_KEY,
      preambleSha256: createHash('sha256').update(preamble).digest('hex'),
      preambleBytes: Buffer.byteLength(preamble, 'utf8')
    }) + '\\n')
    process.stdout.write('\\u001b]0;Codex Working\\u0007ACK\\n')
    setTimeout(() => process.stdout.write('\\u001b]0;Codex Ready\\u0007'), 10)
    // The M2-05 launch/restart spec intentionally leaves ORCA_E2E_CLI_ENTRY unset.
    if (process.env.ORCA_E2E_CLI_ENTRY) {
      const plannerRecipe = preamble.match(/axiom plan propose --mission (\\S+)/)
      if (plannerRecipe) {
        const goalRevisionId = preamble.match(/"goalRevisionId":\\s*"([^"]+)"/)?.[1]
        if (!goalRevisionId) throw new Error('Missing planner GoalRevision')
        spawn(process.execPath, [__filename, '--planner-submit', attemptId, plannerRecipe[1], goalRevisionId], {
          cwd: process.cwd(), env: process.env, detached: true, stdio: 'ignore'
        }).unref()
        return
      }
      if (!artifactRecipe) throw new Error('Missing Artifact protocol recipe')
      void submitFixture(attemptId, artifactRecipe[1], artifactRecipe[2]).catch(error => {
        appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({ kind: 'error', attemptId, message: error.message }) + '\\n')
      })
    }
  })
})
process.stdin.setRawMode?.(true)
process.stdin.resume()
setInterval(() => {}, 60_000)
`
