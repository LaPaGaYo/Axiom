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
