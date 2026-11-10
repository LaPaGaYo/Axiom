import { AXIOM_CODEX_ROLLOUT_SOURCE } from './axiom-codex-rollout'

/** Opt-in fixture work plus the Codex 0.163.0 event shapes observed in the real chain. */
export const AXIOM_INTERRUPTION_EVIDENCE_SOURCE = `${AXIOM_CODEX_ROLLOUT_SOURCE}
function writeInterruptionEvidence(attemptId, taskId) {
  leavePartialWork(taskId)
  writeInterruptionRollout(attemptId, taskId)
}
function leavePartialWork(taskId) {
  const marker = process.env.AXIOM_E2E_LEDGER + '.partial-' + taskId
  if (!existsSync(marker)) return
  const relative = readFileSync(marker, 'utf8').trim()
  const target = path.resolve(process.cwd(), relative)
  const within = path.relative(process.cwd(), target)
  if (!within || path.isAbsolute(relative) || within.startsWith('..') || within.split(path.sep).includes('.git')) throw new Error('Invalid partial work path')
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, '// Axiom interrupted fixture partial work\\nexport const partialWork = true\\n', { flag: 'wx' })
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', id: 'partial-message', text: 'I left partial work for the next Attempt to review.' } }) + '\\n')
  const item = { type: 'command_execution', id: 'partial-command', command: 'git status --short -- ' + JSON.stringify(relative), aggregated_output: '', exit_code: null, status: 'in_progress' }
  process.stdout.write(JSON.stringify({ type: 'item.started', item }) + '\\n')
  const result = spawnSync('git', ['status', '--short', '--', relative], { cwd: process.cwd(), env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, encoding: 'utf8', timeout: 30000 })
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { ...item, aggregated_output: result.stdout, exit_code: result.status, status: result.status === 0 ? 'completed' : 'failed' } }) + '\\n')
}
`
