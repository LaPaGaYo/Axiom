import { FAKE_AGENT_PASTE_END_SCANNER_SOURCE } from './fake-agent-paste-end-scanner'

/** D49: test-only Codex stand-in; capture exactly one delivered ContextPackage, then idle. */
export const AXIOM_TEST_PROVIDER_SOURCE = `
const { appendFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
if (process.argv.slice(2).includes('app-server')) {
  process.stderr.write("error: unrecognized subcommand 'app-server'\\n")
  process.exit(2)
}
${FAKE_AGENT_PASTE_END_SCANNER_SOURCE}
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
  })
})
process.stdin.setRawMode?.(true)
process.stdin.resume()
setInterval(() => {}, 60_000)
`
