import assert from 'node:assert/strict'
import { describe, expect, it } from 'vitest'
import { runProcess } from '@orca/process-host'
import {
  orchestrationMutationRecoveryError,
  renderCommand,
  renderResolvedOrchestrationCommand
} from './orchestration-mutation-recovery'
import { RuntimeClientError } from './runtime-client'

describe('orchestration mutation recovery', () => {
  it('queries a known dispatch before issuing the keyed retry', () => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_timeout', 'request timed out', {
        orchestrationRequestId: 'request_1',
        dispatchId: 'dispatch_1',
        originalCommand: ['axiom', 'orchestration', 'worker-start', '--task', 'task_1']
      })
    )
    assert(result instanceof RuntimeClientError)

    expect(result.data).toMatchObject({
      recovery: {
        orchestrationRequestId: 'request_1',
        dispatchId: 'dispatch_1',
        queryCommand: [
          'axiom',
          'orchestration',
          'worker-show',
          '--dispatch',
          'dispatch_1',
          '--json'
        ],
        retryCommand: [
          'axiom',
          'orchestration',
          'worker-start',
          '--task',
          'task_1',
          '--retry-request',
          'request_1'
        ],
        workerDeathInferred: false
      }
    })
    expect(result.message.indexOf('axiom orchestration worker-show')).toBeLessThan(
      result.message.indexOf('axiom orchestration worker-start')
    )
    expect(result.data).toHaveProperty('nextSteps', [
      'Run axiom orchestration worker-show --dispatch dispatch_1 --json before retrying.',
      'After inspecting the Dispatch, if keyed recovery is still needed, run axiom orchestration worker-start --task task_1 --retry-request request_1 from this same terminal. --retry-request reuses the same operation identity so Axiom can replay, join, or safely recover it without starting a separate duplicate.'
    ])
  })

  it('does not invent a dispatch for an old-client-shaped error', () => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_timeout', 'request timed out', {
        orchestrationRequestId: 'request_2',
        originalCommand: ['axiom', 'orchestration', 'worker-start', '--task', 'task_2']
      })
    )
    assert(result instanceof RuntimeClientError)

    expect(result.data).toMatchObject({
      recovery: {
        orchestrationRequestId: 'request_2',
        retryCommand: expect.arrayContaining(['--retry-request', 'request_2']),
        workerDeathInferred: false
      }
    })
    expect(result.data).not.toHaveProperty('recovery.dispatchId')
    expect(result.message).not.toContain('worker death')
  })

  it('offers a read-only request lookup when the response carried no dispatch', () => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_unavailable', 'runtime unavailable', {
        orchestrationRequestId: 'request_4',
        originalCommand: ['axiom', 'orchestration', 'worker-start', '--task', 'task_4']
      })
    )
    assert(result instanceof RuntimeClientError)

    expect(result.data).toMatchObject({
      recovery: {
        queryCommand: ['axiom', 'orchestration', 'request-show', '--request', 'request_4', '--json']
      }
    })
    expect(result.data).toHaveProperty(
      'nextSteps.0',
      'Run axiom orchestration request-show --request request_4 --json before retrying.'
    )
  })

  it('describes keyed retry without overclaiming one replay outcome', () => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_timeout', 'request timed out', {
        orchestrationRequestId: 'request_5',
        originalCommand: ['axiom', 'orchestration', 'worker-start', '--task', 'task_5']
      })
    )
    assert(result instanceof RuntimeClientError)

    expect(result.data).toHaveProperty(
      'nextSteps.1',
      expect.stringContaining(
        'replay, join, or safely recover it without starting a separate duplicate'
      )
    )
    expect(result.data).toHaveProperty(
      'nextSteps.1',
      expect.stringContaining('absence does not prove a retry is safe')
    )
  })

  it('renders the exact executable and safely quotes original arguments', () => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_timeout', 'request timed out', {
        orchestrationRequestId: 'request_3',
        dispatchId: 'dispatch_3',
        originalCommand: [
          'axiom-dev',
          'orchestration',
          'worker-start',
          '--task',
          'task 3',
          '--comment',
          'literal $(do-not-run)'
        ]
      })
    )
    assert(result instanceof RuntimeClientError)

    expect(result.data).toHaveProperty('nextSteps', [
      'Run axiom-dev orchestration worker-show --dispatch dispatch_3 --json before retrying.',
      "After inspecting the Dispatch, if keyed recovery is still needed, run axiom-dev orchestration worker-start --task 'task 3' --comment 'literal $(do-not-run)' --retry-request request_3 from this same terminal. --retry-request reuses the same operation identity so Axiom can replay, join, or safely recover it without starting a separate duplicate."
    ])
    expect(result.message).toContain("'literal $(do-not-run)'")
  })

  it('parses legacy command text without losing quoted arguments', () => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_timeout', 'request timed out', {
        orchestrationRequestId: 'request_4',
        originalCommand:
          'orca-ide orchestration worker-stop --dispatch dispatch_4 --comment "quoted value"'
      })
    )
    assert(result instanceof RuntimeClientError)

    expect(result.data).toHaveProperty('recovery.retryCommand', [
      'orca-ide',
      'orchestration',
      'worker-stop',
      '--dispatch',
      'dispatch_4',
      '--comment',
      'quoted value',
      '--retry-request',
      'request_4'
    ])
  })

  it.each([
    [
      'gate-create',
      ['axiom', 'orchestration', 'gate-create', '--task', 'task_1', '--question', 'ship?']
    ],
    [
      'worker-retain',
      ['axiom', 'orchestration', 'worker-retain', '--dispatch', 'dispatch_1', '--json']
    ]
  ])('replays exact %s argv with the keyed retry', (_name, originalCommand) => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_timeout', 'request timed out', {
        orchestrationRequestId: 'request_exact',
        originalCommand
      })
    )
    assert(result instanceof RuntimeClientError)

    expect(result.data).toHaveProperty('recovery.retryCommand', [
      ...originalCommand,
      '--retry-request',
      'request_exact'
    ])
  })

  it('reuses the request identity without duplicating an existing retry flag', () => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_timeout', 'request timed out', {
        orchestrationRequestId: 'request_reused',
        originalCommand: [
          'axiom',
          'orchestration',
          'worker-retain',
          '--dispatch',
          'dispatch_1',
          '--retry-request=request_reused'
        ]
      })
    )
    assert(result instanceof RuntimeClientError)

    expect(result.data).toHaveProperty('recovery.retryCommand', [
      'axiom',
      'orchestration',
      'worker-retain',
      '--dispatch',
      'dispatch_1',
      '--retry-request',
      'request_reused'
    ])
  })

  it('renders Windows cmd recovery guidance without quote drift or percent expansion', () => {
    expect(
      renderCommand(
        ['axiom', 'orchestration', 'worker-start', '--comment', 'literal "quoted" %PATH% & safe'],
        'win32',
        { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
      )
    ).toBe(
      '"axiom" "orchestration" "worker-start" "--comment" "literal ""quoted"" "^%"PATH"^%" & safe"'
    )
  })

  it.each(['axiom', 'orca'])(
    'shell-quotes a configured Windows executable for portable %s recovery commands',
    (command) => {
      expect(
        renderResolvedOrchestrationCommand(
          `${command} orchestration worker-show --dispatch ctx_1 --json`,
          'C:\\Program Files\\Axiom\\orca-ide.cmd',
          'win32',
          { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
        )
      ).toBe(
        '"C:\\Program Files\\Axiom\\orca-ide.cmd" "orchestration" "worker-show" "--dispatch" "ctx_1" "--json"'
      )
    }
  )

  it('keeps PowerShell and POSIX recovery guidance literal', () => {
    expect(
      renderCommand(['axiom', 'literal "quoted" $HOME'], 'win32', {
        ComSpec: 'powershell.exe'
      })
    ).toBe("& 'axiom' 'literal \\\"quoted\\\" $HOME'")
    expect(renderCommand(['axiom', 'literal $(do-not-run)'], 'darwin')).toBe(
      "axiom 'literal $(do-not-run)'"
    )
  })

  it.runIf(process.platform !== 'win32')(
    'round trips POSIX recovery argv through /bin/sh',
    async () => {
      const values = ['with spaces', "apostrophe's", 'literal $(do-not-run)', 'line one\nline two']
      const command = renderCommand(
        [
          process.execPath,
          '-e',
          'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
          ...values
        ],
        'darwin'
      )

      const result = await runProcess({ program: '/bin/sh', args: ['-c', command] })

      expect(result).toMatchObject({ code: 0, stderr: '', timedOut: false })
      expect(JSON.parse(result.stdout)).toEqual(values)
    }
  )

  it.each([
    [
      'split',
      ['axiom', 'orchestration', 'send', '--pairing-code', 'split-secret', '--subject', 'status'],
      'split-secret'
    ],
    [
      'equals',
      ['axiom', 'orchestration', 'send', '--pairing-code=equals-secret', '--subject', 'status'],
      'equals-secret'
    ],
    [
      'dispatch split',
      [
        'axiom',
        'orchestration',
        'send',
        '--dispatch-capability',
        'split-dispatch-secret',
        '--subject',
        'status'
      ],
      'split-dispatch-secret'
    ],
    [
      'dispatch equals',
      [
        'axiom',
        'orchestration',
        'send',
        '--dispatch-capability=equals-dispatch-secret',
        '--subject',
        'status'
      ],
      'equals-dispatch-secret'
    ]
  ])('blocks recovery and removes %s credentials', (_name, originalCommand, secret) => {
    const result = orchestrationMutationRecoveryError(
      new RuntimeClientError('runtime_timeout', 'request timed out', {
        orchestrationRequestId: 'request_secret',
        originalCommand
      })
    )
    assert(result instanceof RuntimeClientError)
    const output = JSON.stringify({ message: result.message, data: result.data })

    expect(output).not.toContain(secret)
    expect(result.message).toContain('Recovery is blocked')
    expect(result.data).toMatchObject({
      recovery: {
        orchestrationRequestId: 'request_secret',
        recoveryBlocked: true
      }
    })
    expect(result.data).not.toHaveProperty('originalCommand')
    expect(result.data).not.toHaveProperty('recovery.retryCommand')
  })

  // Pins the outcome-unknown codes (round-2 S5): only these get recovery guidance.
  it.each([
    ['runtime_unavailable', true],
    ['remote_runtime_unavailable', true],
    ['runtime_timeout', true],
    ['invalid_runtime_response', true],
    ['runtime_manually_disconnected', false],
    ['remote_runtime_timeout', false],
    ['runtime_rpc_queue_overloaded', false],
    ['invalid_argument', false]
  ])('treats %s as an unknown mutation outcome: %s', (code, unknown) => {
    const error = new RuntimeClientError(code, 'failed', { orchestrationRequestId: 'request-1' })
    expect(orchestrationMutationRecoveryError(error) !== error).toBe(unknown)
  })
})
