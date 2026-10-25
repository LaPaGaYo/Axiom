import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { buildHeadlessTerminalCommand } from './control-plane-worker-start'

it.skipIf(process.platform === 'win32')(
  'preserves the child exit code through tee and keeps the terminal alive for release',
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "axiom-headless-quote'-"))
    const stdinPath = path.join(directory, 'prompt.md')
    await writeFile(stdinPath, 'private prompt')
    const { command } = buildHeadlessTerminalCommand({
      argv: ['/bin/bash', '-c', 'read -r prompt; printf \'{"type":"turn.started"}\\n\'; exit 7'],
      env: {},
      stdinPath,
      attemptDir: directory
    })
    const process = spawn('/bin/bash', ['-c', command], { detached: true, stdio: 'ignore' })
    try {
      await expect
        .poll(async () => {
          try {
            return await readFile(path.join(directory, 'exit-code'), 'utf8')
          } catch {
            return undefined
          }
        })
        .toBe('7\n')
      expect(await readFile(path.join(directory, 'events.jsonl'), 'utf8')).toBe(
        '{"type":"turn.started"}\n'
      )
      expect(process.exitCode).toBeNull()
    } finally {
      if (process.pid) {
        globalThis.process.kill(-process.pid, 'SIGKILL')
      }
      await rm(directory, { recursive: true, force: true })
    }
  }
)
