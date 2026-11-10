/** Opt-in protocol fixture; included in the Codex stub, never in a production bundle. */
export const AXIOM_CODEX_ROLLOUT_SOURCE = `
function writeInterruptionRollout(attemptId, taskId) {
  if (!existsSync(process.env.AXIOM_E2E_LEDGER + '.rollout-' + taskId)) return
  const home = process.env.CODEX_HOME
  if (!home) throw new Error('Missing fixture CODEX_HOME')
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  const day = [String(now.getFullYear()), pad(now.getMonth() + 1), pad(now.getDate())]
  const time = [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('-')
  const threadId = 'fixture-' + attemptId
  const directory = path.join(home, 'sessions', ...day)
  mkdirSync(directory, { recursive: true })
  const file = path.join(directory, 'rollout-' + day.join('-') + 'T' + time + '-' + threadId + '.jsonl')
  const resetsAt = Math.floor(now.getTime() / 1000) + 10
  const records = [
    { timestamp: now.toISOString(), type: 'session_meta', payload: {
      id: threadId, creator_account_id: 'ROLLOUT_DECOY_ACCOUNT'
    } },
    { timestamp: now.toISOString(), type: 'event_msg', payload: {
      type: 'token_count', info: null, rate_limits: {
        limit_id: 'codex',
        primary: { used_percent: 100, window_minutes: 300, resets_at: resetsAt },
        secondary: { used_percent: 4, window_minutes: 10080, resets_at: resetsAt + 86400 },
        plan_type: 'ROLLOUT_DECOY_PLAN', credits: { balance: 'ROLLOUT_DECOY_BALANCE' }
      }
    } }
  ]
  writeFileSync(file, records.map(record => JSON.stringify(record)).join('\\n') + '\\n')
}
`
