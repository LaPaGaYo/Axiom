/** Opt-in Codex version and resume behavior captured by the 0.163.0 host probes. */
export const AXIOM_CODEX_RESUME_SOURCE = String.raw`
function fixtureCodexVersion() {
  const marker = process.env.AXIOM_E2E_LEDGER + '.version'
  return existsSync(marker) ? readFileSync(marker, 'utf8').trim() : 'codex-cli 0.0.0-e2e'
}
function fixtureSessionRecorded(directory, threadId) {
  let entries
  try { entries = require('node:fs').readdirSync(directory, { withFileTypes: true }) }
  catch { return false }
  return entries.some(entry => entry.isDirectory()
    ? fixtureSessionRecorded(path.join(directory, entry.name), threadId)
    : entry.isFile() && entry.name.startsWith('rollout-') &&
      (entry.name.endsWith('-' + threadId + '.jsonl') || entry.name.endsWith('-' + threadId + '.jsonl.zst')))
}
function fixtureCodexSession(argv, attemptId, taskId) {
  if (argv.at(-3) !== 'resume' || argv.at(-1) !== '-') return 'fixture-' + attemptId
  const threadId = argv.at(-2)
  const marker = process.env.AXIOM_E2E_LEDGER + '.refuse-resume-' + taskId
  const refusedByMarker = existsSync(marker)
  if (refusedByMarker) rmSync(marker)
  if (!refusedByMarker && process.env.CODEX_HOME && /^[A-Za-z0-9_-]{1,128}$/.test(threadId) &&
      fixtureSessionRecorded(path.join(process.env.CODEX_HOME, 'sessions'), threadId)) return threadId
  appendFileSync(process.env.AXIOM_E2E_LEDGER, JSON.stringify({
    kind: 'resume_refused', attemptId, taskId, threadId,
    marker: refusedByMarker ? 'refuse-resume' : 'session_record_missing'
  }) + '\n')
  process.stderr.write('Error: thread/resume: thread/resume failed: no rollout found for thread id ' + threadId + ' (code -32600)\n')
  process.exit(1)
}
`
