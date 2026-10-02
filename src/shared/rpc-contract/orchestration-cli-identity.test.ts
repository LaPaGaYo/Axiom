import { describe, expect, it } from 'vitest'
import { AskParams, CheckParams } from './orchestration-params'

describe('mixed-version CLI identities', () => {
  it.each(['axiom', 'axiom-dev', 'orca', 'orca-ide', 'orca-dev'])(
    'accepts %s from a runtime',
    (compatibilityCliCommand) => {
      expect(CheckParams.safeParse({ compatibilityCliCommand }).success).toBe(true)
      expect(AskParams.safeParse({ question: 'Continue?', compatibilityCliCommand }).success).toBe(
        true
      )
    }
  )
})

describe('mixed-version Windows resume identities', () => {
  it.each(['axiom', 'axiom-dev', 'orca', 'orca-ide'])(
    'accepts %s without removing older command names',
    (compatibilityWindowsCommand) => {
      expect(
        AskParams.safeParse({ question: 'Continue?', compatibilityWindowsCommand }).success
      ).toBe(true)
    }
  )
})
