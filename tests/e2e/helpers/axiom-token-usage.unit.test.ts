import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'
import { AXIOM_CODEX_ROLLOUT_SOURCE } from './axiom-codex-rollout'
import { AXIOM_CLAUDE_USAGE_SOURCE } from './axiom-claude-usage'

const directories: string[] = []
afterEach(() => {
  for (const root of directories.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

it('writes the opt-in Codex increments with a byte-identical duplicate and private decoys', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'axiom-usage-stub-'))
  directories.push(root)
  const ledger = path.join(root, 'ledger')
  const home = path.join(root, 'account')
  const context = {
    existsSync,
    mkdirSync,
    writeFileSync,
    path,
    process: { env: { AXIOM_E2E_LEDGER: ledger, CODEX_HOME: home }, argv: ['node', 'stub'] }
  }
  const execute = () =>
    runInNewContext(`${AXIOM_CODEX_ROLLOUT_SOURCE}\nwriteUsageRollout('attempt', 'task')`, context)
  execute()
  expect(existsSync(home)).toBe(false)
  writeFileSync(`${ledger}.usage-task`, '')
  execute()
  const files = readdirSync(home, { recursive: true }).filter((entry) =>
    String(entry).endsWith('.jsonl')
  )
  expect(files).toHaveLength(1)
  const file = z.string().parse(files[0])
  const lines = readFileSync(path.join(home, file), 'utf8').trim().split('\n')
  expect(lines[2]).toBe(lines[4])
  expect(lines.join('\n')).toContain('USAGE_DECOY_ACCOUNT')
  expect(lines.join('\n')).toContain('USAGE_DECOY_PLAN')
  expect(lines.join('\n')).toContain('USAGE_DECOY_CREDITS')
  expect(JSON.parse(lines[2])).toMatchObject({
    payload: {
      info: {
        last_token_usage: {
          input_tokens: 1000,
          cached_input_tokens: 400,
          output_tokens: 50,
          reasoning_output_tokens: 10
        }
      }
    }
  })
  expect(JSON.parse(lines[3])).toMatchObject({
    payload: {
      info: {
        last_token_usage: {
          input_tokens: 2000,
          cached_input_tokens: 1500,
          output_tokens: 80,
          reasoning_output_tokens: 20
        },
        total_token_usage: { input_tokens: 3000, cached_input_tokens: 1900, output_tokens: 130 }
      }
    }
  })
})

it('emits Claude assistant usage only for the selected Task', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'axiom-usage-stub-'))
  directories.push(root)
  const ledger = path.join(root, 'ledger')
  const events: unknown[] = []
  const context = {
    existsSync,
    process: { env: { AXIOM_E2E_LEDGER: ledger } },
    emit: (event: unknown) => events.push(event)
  }
  const execute = () =>
    runInNewContext(`${AXIOM_CLAUDE_USAGE_SOURCE}\nemitFixtureClaudeUsage(emit, 'task')`, context)
  execute()
  expect(events).toEqual([])
  writeFileSync(`${ledger}.usage-another-task`, '')
  execute()
  expect(events).toEqual([])
  writeFileSync(`${ledger}.usage-task`, '')
  execute()
  expect(events).toMatchObject([
    {
      type: 'assistant',
      message: {
        id: 'A',
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 300,
          cache_read_input_tokens: 1000,
          output_tokens: 5
        }
      }
    },
    {
      type: 'assistant',
      message: {
        id: 'A',
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 300,
          cache_read_input_tokens: 1000,
          output_tokens: 40
        }
      }
    },
    {
      type: 'assistant',
      parent_tool_use_id: 'fixture-subagent',
      message: {
        id: 'B',
        usage: {
          input_tokens: 20,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 1300,
          output_tokens: 60
        }
      }
    }
  ])
})
