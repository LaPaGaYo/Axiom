import { FAKE_AGENT_PASTE_END_SCANNER_SOURCE } from './fake-agent-paste-end-scanner'

/** D49: capture the preamble; the submit spec supplies a compiled CLI to run the frozen stub. */
export const AXIOM_TEST_PROVIDER_SOURCE = `
const { appendFileSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
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
async function submitFixture(attemptId, capability, missionId, taskId) {
  const deadline = Date.now() + 60000
  // Preamble acknowledgment precedes the launcher's binding CAS. Wait for that public identity.
  while (!cli(['attempt', 'show', '--attempt', attemptId]).response.ok) {
    if (Date.now() >= deadline) throw new Error('Attempt binding timeout')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const command = ['scenarios/stub-worker/worker.mjs', '--scenario', 'retry', '--attempt', '1', '--mode', 'succeed', '--cwd', process.cwd()]
  const started = Date.now()
  const stub = spawnSync(process.execPath, command, { cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 60000 })
  if (stub.status !== 0) throw new Error('Fixture stub failed')
  // The frozen stub emits identical reports. Attribute this copy before content-addressing it,
  // so Artifact deduplication cannot reuse a different Task's related metadata.
  appendFileSync(path.join(process.cwd(), 'REPORT.md'), '\\nmission: ' + missionId + '\\ntaskId: ' + taskId + '\\nattemptId: ' + attemptId + '\\n')
  const artifact = cli(['mission', 'artifact', 'put', '--mission', missionId, '--kind', 'worker_report', '--file', 'REPORT.md', '--related', taskId])
  appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({ kind: 'artifact', attemptId, ...artifact }) + '\\n')
  if (!artifact.response.ok) throw new Error('Artifact put failed')
  const artifactId = artifact.response.result.artifact.id
  const changed = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' })
  if (changed.status !== 0) throw new Error('Fixture diff failed')
  const report = {
    summary: 'D49 retry scenario attempt 1 succeeded',
    filesChanged: [...new Set([...changed.stdout.trim().split(/\\r?\\n/).filter(Boolean), 'REPORT.md'])],
    checksRun: [{ command: 'node ' + command.join(' '), result: 'pass', durationMs: Date.now() - started },
      { command: 'fixture verification', result: 'skipped', note: 'Stub Worker; independent verification is queued for M3.' }],
    artifacts: [artifactId], limitations: ['Fixture stub; no independent verification run by Worker'],
    risks: ['Write scope is enforced during M3 verification'], questions: [], followUps: ['VerificationService dequeues QUEUED']
  }
  // Keep the protocol envelope outside the Candidate snapshot.
  const temp = mkdtempSync(path.join(os.tmpdir(), 'axiom-submit-report-'))
  try {
    const file = path.join(temp, 'report.json')
    writeFileSync(file, JSON.stringify(report))
    const submission = cli(['attempt', 'submit', '--attempt', attemptId, '--dispatch-capability', capability, '--report', file])
    appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({ kind: 'submission', attemptId, ...submission }) + '\\n')
    if (!submission.response.ok) throw new Error('Attempt submit failed')
  } finally {
    rmSync(temp, { recursive: true, force: true })
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
    const capability = preamble.match(/--dispatch-capability (dcap_[A-Za-z0-9_-]+)/)?.[1]
    const artifactRecipe = preamble.match(/axiom mission artifact put --mission (\\S+) --kind <kind> --file <path> --related (\\S+)/)
    if (!attemptId || !capability || mode !== 'bracketed') {
      process.stdout.write('PASTE_PROTOCOL_ERROR\\n')
      return
    }
    recorded = true
    appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({
      cwd: process.cwd(), attemptId, capability,
      preambleSha256: createHash('sha256').update(preamble).digest('hex'),
      preambleBytes: Buffer.byteLength(preamble, 'utf8')
    }) + '\\n')
    process.stdout.write('\\u001b]0;Codex Working\\u0007ACK\\n')
    setTimeout(() => process.stdout.write('\\u001b]0;Codex Ready\\u0007'), 10)
    // The M2-05 launch/restart spec intentionally leaves ORCA_E2E_CLI_ENTRY unset.
    if (process.env.ORCA_E2E_CLI_ENTRY) {
      if (!artifactRecipe) throw new Error('Missing Artifact protocol recipe')
      void submitFixture(attemptId, capability, artifactRecipe[1], artifactRecipe[2]).catch(error => {
        appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({ kind: 'error', attemptId, message: error.message }) + '\\n')
      })
    }
  })
})
process.stdin.setRawMode?.(true)
process.stdin.resume()
setInterval(() => {}, 60_000)
`
