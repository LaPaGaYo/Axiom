import { FAKE_AGENT_PASTE_END_SCANNER_SOURCE } from './fake-agent-paste-end-scanner'

/** D49: capture the preamble; the submit spec supplies a compiled CLI to run the frozen stub. */
export const AXIOM_TEST_PROVIDER_SOURCE = `
const { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
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
async function submitFixture(attemptId, missionId, taskId, outputPath) {
  const headless = Boolean(outputPath)
  const deadline = Date.now() + 60000
  let seq
  if (headless) {
    while (existsSync(process.env.AXIOM_E2E_LEDGER + '.hold')) await new Promise(resolve => setTimeout(resolve, 50))
    const branch = spawnSync('git', ['branch', '--show-current'], { cwd: process.cwd(), encoding: 'utf8' })
    seq = Number(branch.stdout.trim().split('/').at(-1))
  } else {
    let response
    while (!(response = cli(['attempt', 'show', '--attempt', attemptId]).response).ok) {
      if (Date.now() >= deadline) throw new Error('Attempt binding timeout')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    seq = response.result.attempt.seq
  }
  const crashMarker = process.env.AXIOM_E2E_LEDGER + '.crash-' + taskId
  if (existsSync(crashMarker)) {
    rmSync(crashMarker)
    appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({ kind: 'crash', attemptId, taskId }) + '\\n')
    const crashed = spawnSync(process.execPath, ['scenarios/stub-worker/worker.mjs', '--scenario', 'agent-crash', '--mode', 'crash', '--cwd', process.cwd()], {
      cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 60000
    })
    if (headless) process.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message: 'Fixture Worker crashed' } }) + '\\n')
    process.exit(crashed.status || 1)
  }
  const scenarioMarker = process.env.AXIOM_E2E_LEDGER + '.scenario-' + taskId
  const scenario = existsSync(scenarioMarker) ? readFileSync(scenarioMarker, 'utf8').trim() : 'retry'
  if (headless && scenario === 'exit-nonzero') {
    rmSync(scenarioMarker)
    process.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message: 'fixture work failed' } }) + '\\n')
    process.exit(7)
  }
  if (headless && scenario === 'bad-report') {
    writeFileSync(outputPath, 'Invalid final report')
    process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 20, output_tokens: 2 } }) + '\\n')
    return
  }
  const tamperProbes = {
    'test-skip': { file: 'date.test.ts', expected: "\\ntest('extended years", replacement: "\\ntest.skip('extended years" },
    'assertion-drop': { file: 'guards.test.ts', expected: '  expect(strings([1])).toBe(false)\\n', replacement: '' },
    'suppression': { file: 'clock.test.ts', expected: "test('fixed clocks normalize instants and reject malformed input', () => {" }
  }
  const tamper = tamperProbes[scenario]
  if (!tamper && !['retry', 'deterministic-failure', 'agent-crash', 'scope-violation', 'secret-line', 'transcript-secret', 'self-approve'].includes(scenario)) throw new Error('Unknown fixture scenario')
  // Keep both the Worker Artifact and protocol envelope outside the Candidate snapshot.
  const temp = headless ? path.join(process.cwd(), '.axiom', 'artifacts') : mkdtempSync(path.join(os.tmpdir(), 'axiom-submit-report-'))
  if (headless) mkdirSync(temp, { recursive: true })
  try {
    if (scenario === 'transcript-secret') {
      process.stdout.write('Transcript redaction probe: ' + 'gh' + 'p_' + 'T'.repeat(36) + '\\n')
    }
    const command = ['scenarios/stub-worker/worker.mjs', '--scenario', scenario === 'transcript-secret' ? 'retry' : scenario, '--attempt', String(Math.min(seq, 2)), '--mode', 'succeed', '--cwd', process.cwd()]
    const started = Date.now()
    const providerOnly = Boolean(tamper) || scenario === 'scope-violation' || scenario === 'secret-line' || scenario === 'self-approve'
    let reportText
    if (providerOnly) {
      if (scenario === 'self-approve') {
        const plans = cli(['plan', 'list', '--mission', missionId])
        const plan = plans.response.result?.planRevisions.find(row => row.status === 'APPROVED')
        if (!plans.response.ok || !plan) throw new Error('Missing current PlanRevision')
        const rulesFile = path.join(temp, 'verification-rules.json')
        writeFileSync(rulesFile, JSON.stringify({ testPathPatterns: [] }))
        const probes = [
          ['plan.approve', ['plan', 'approve', '--plan', plan.id, '--resolver', 'worker-self-approve']],
          ['policy.update', ['mission', 'policy', 'update', '--mission', missionId, '--verification-rules-file', rulesFile]],
          ['message.answer', ['message', 'answer', '--mission', missionId, '--question', 'q_does_not_exist', '--body', 'x']]
        ]
        reportText = probes.map(([method, args]) => {
          const result = cli(args)
          return method + ' exitCode=' + result.status + ' errorCode=' + (result.response.error?.code ?? 'none')
        }).join('\\n') + '\\n'
      } else if (tamper) {
        const file = path.join(process.cwd(), 'src', 'domain', tamper.file)
        const content = readFileSync(file, 'utf8')
        if (!content.includes(tamper.expected)) throw new Error('Missing fixture text: ' + scenario)
        if (scenario === 'suppression') appendFileSync(file, '/* c8 ignore next */\\n')
        else writeFileSync(file, content.replace(tamper.expected, tamper.replacement))
      } else if (scenario === 'scope-violation') {
        appendFileSync(path.join(process.cwd(), 'README.md'), '\\n<!-- axiom e2e scope probe -->\\n')
      } else {
        const token = 'gh' + 'p_' + 'Z'.repeat(36)
        appendFileSync(path.join(process.cwd(), 'src', 'services', 'csv.ts'), '// axiom e2e probe ' + token + '\\n')
      }
      reportText ??= 'Provider diff-gate probe: ' + scenario + '\\n'
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
    let artifactId
    if (!headless) {
      const artifact = cli(['mission', 'artifact', 'put', '--attempt', attemptId, '--mission', missionId, '--kind', 'worker_report', '--file', reportPath, '--related', taskId])
      appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({ kind: 'artifact', attemptId, ...artifact }) + '\\n')
      if (!artifact.response.ok) throw new Error('Artifact put failed')
      artifactId = artifact.response.result.artifact.id
    }
    const changed = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' })
    if (changed.status !== 0) throw new Error('Fixture diff failed')
    const report = {
      summary: 'D49 ' + scenario + ' scenario attempt ' + seq + ' succeeded',
      filesChanged: changed.stdout.trim().split(/\\r?\\n/).filter(Boolean),
      checksRun: [{ command: providerOnly ? 'provider scenario ' + scenario : 'node ' + command.join(' '), result: 'pass', durationMs: Date.now() - started },
        { command: 'fixture verification', result: 'skipped', note: 'Stub Worker; independent verification is queued for M3.' }],
      artifacts: headless ? [{ path: '.axiom/artifacts/REPORT.md', kind: 'worker_report', mediaType: 'text/markdown' }] : [artifactId], limitations: ['Fixture stub; no independent verification run by Worker'],
      risks: ['Write scope is enforced during M3 verification'], questions: [], followUps: ['VerificationService dequeues QUEUED']
    }
    if (headless) {
      delete report.filesChanged
      writeFileSync(outputPath, reportText + '\\n\`\`\`json\\n' + JSON.stringify(report) + '\\n\`\`\`\\n')
      process.stdout.write(JSON.stringify({ type: 'item.completed', item: { id: 'item-1', type: 'agent_message', text: report.summary } }) + '\\n')
      process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 25 } }) + '\\n')
      return
    }
    const file = path.join(temp, 'report.json')
    writeFileSync(file, JSON.stringify(report))
    const submission = cli(['attempt', 'submit', '--attempt', attemptId, '--report', file])
    appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({ kind: 'submission', attemptId, ...submission }) + '\\n')
    if (!submission.response.ok) throw new Error('Attempt submit failed')
  } finally {
    if (!headless) rmSync(temp, { recursive: true, force: true })
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
if (process.argv[2] === 'exec') {
  const argv = process.argv.slice(2)
  const flag = name => argv[argv.indexOf(name) + 1]
  const outputPath = flag('-o')
  process.chdir(flag('-C'))
  const promptPath = path.join(path.dirname(outputPath), 'prompt.md')
  const prompt = readFileSync(0, 'utf8')
  const attemptId = prompt.match(/^Attempt: (\\S+)/m)?.[1]
  const missionId = prompt.match(/^Mission: (\\S+)/m)?.[1]
  const taskId = prompt.match(/^Task: (\\S+)/m)?.[1]
  if (!attemptId || !missionId || !taskId || !argv.includes('--json') || flag('-s') !== 'workspace-write') throw new Error('Invalid headless fixture launch')
  appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({
    cwd: process.cwd(), attemptId, terminalHandle: process.env.ORCA_TERMINAL_HANDLE, paneKey: process.env.ORCA_PANE_KEY,
    preambleSha256: createHash('sha256').update(prompt).digest('hex'), preambleBytes: Buffer.byteLength(prompt),
    argv, promptPath, CODEX_HOME: process.env.CODEX_HOME ?? null
  }) + '\\n')
  process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'fixture-' + attemptId }) + '\\n')
  process.stdout.write(JSON.stringify({ type: 'turn.started' }) + '\\n')
  // The launch-only spec deliberately keeps a live Worker without a submission.
  if (!process.env.ORCA_E2E_CLI_ENTRY) setInterval(() => {}, 60000)
  else void submitFixture(attemptId, missionId, taskId, outputPath).then(() => process.exit(0)).catch(error => {
    process.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message: error.message } }) + '\\n')
    process.exit(1)
  })
} else {
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
    const artifactRecipe = preamble.match(/axiom mission artifact put --attempt \\S+ --mission (\\S+) --kind <kind> --file <path> --related (\\S+)/)
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
}
`
