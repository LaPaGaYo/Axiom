#!/usr/bin/env node
// M0 exit check: launch the PACKAGED app (electron-builder --dir output) with every network path
// routed through a loopback recording proxy that answers 502 / drops CONNECTs, keep it in the
// foreground for a while (cold start + idle + window shown), then print the per-host tally.
// Usage: node .axiom-work/scripts/packaged-egress-capture.mjs <path-to-Axiom.app> [seconds]
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const appPath = process.argv[2]
const seconds = Number(process.argv[3] ?? 60)
if (!appPath || !existsSync(appPath)) {
  console.error('usage: packaged-egress-capture.mjs <Axiom.app> [seconds]')
  process.exit(2)
}
const binary = join(appPath, 'Contents', 'MacOS', 'Axiom')
if (!existsSync(binary)) {
  console.error(`missing binary: ${binary}`)
  process.exit(2)
}

const tally = new Map()
const record = (host, kind) => {
  const h = (host ?? '').split(':')[0] || '<empty>'
  const key = `${h} (${kind})`
  tally.set(key, (tally.get(key) ?? 0) + 1)
  console.log(`[egress] ${new Date().toISOString()} ${kind} ${host}`)
}
const proxy = createServer((req, res) => {
  let host = req.headers.host
  try {
    host = new URL(req.url, 'http://x').host || host
  } catch {
    // keep the Host header
  }
  record(host, 'http')
  res.statusCode = 502
  res.end('blocked by packaged-egress-capture')
})
proxy.on('connect', (req, socket) => {
  record(req.url, 'CONNECT')
  setTimeout(() => socket.destroy(), 300)
})
await new Promise((r) => proxy.listen(0, '127.0.0.1', r))
const port = proxy.address().port
const proxyUrl = `http://127.0.0.1:${port}`
console.log(`[proxy] listening on ${proxyUrl}`)

const userData = mkdtempSync(join(tmpdir(), 'axiom-packaged-egress-'))
const home = join(userData, 'home')
mkdirSync(home, { recursive: true, mode: 0o700 })
const env = {
  ...process.env,
  HOME: home,
  ORCA_E2E_USER_DATA_DIR: userData,
  ORCA_E2E_HOME_DIR: home,
  HTTP_PROXY: proxyUrl,
  HTTPS_PROXY: proxyUrl,
  ALL_PROXY: proxyUrl,
  http_proxy: proxyUrl,
  https_proxy: proxyUrl,
  NODE_USE_ENV_PROXY: '1',
  NO_PROXY: 'localhost,127.0.0.1,::1',
  no_proxy: 'localhost,127.0.0.1,::1'
}
console.log(`[launch] ${binary} (userData ${userData}, HOME ${home}) for ${seconds}s`)
const child = spawn(binary, [`--proxy-server=127.0.0.1:${port}`, '--proxy-bypass-list=<-loopback>'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe']
})
child.stdout.on('data', (d) => process.stdout.write(`[app] ${d}`))
child.stderr.on('data', (d) => process.stdout.write(`[app:err] ${d}`))
let exited = null
child.on('exit', (code, signal) => {
  exited = { code, signal }
  console.log(`[app] exited code=${code} signal=${signal}`)
})

await new Promise((r) => setTimeout(r, seconds * 1000))
if (!exited) {
  child.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 3000))
  if (!exited) {
    child.kill('SIGKILL')
  }
}
proxy.close()
const result = Object.fromEntries([...tally.entries()].sort())
console.log('[egress-host-tally packaged]')
console.log(JSON.stringify(result, null, 2))
const vendor = Object.keys(result).filter((k) => /onorca\.dev|orca\.dev|stablyai|posthog|api\.github\.com|storage\.googleapis\.com/.test(k))
console.log(`[verdict] vendor hosts: ${vendor.length === 0 ? 'none' : vendor.join(', ')}; non-loopback total: ${Object.values(result).reduce((a, b) => a + b, 0)}`)
try {
  rmSync(userData, { recursive: true, force: true })
} catch {
  // best-effort cleanup
}
process.exit(vendor.length === 0 && Object.keys(result).length === 0 ? 0 : 1)
