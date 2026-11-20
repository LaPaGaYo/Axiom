import { expect, it } from 'vitest'
import { ApprovalGrantParams, ApprovalDenyParams } from './approval-params'

it('grant params are an approval id and nothing else', () => {
  expect(ApprovalGrantParams.parse({ approvalId: 'approval-one' })).toEqual({
    approvalId: 'approval-one'
  })
  for (const input of [
    {},
    { approvalId: '' },
    { approvalId: 'approval-one', resolver: 'someone' },
    { approvalId: 'approval-one', extra: true }
  ]) {
    expect(ApprovalGrantParams.safeParse(input).success).toBe(false)
  }
})

it('deny params add a reason of at most 2000 characters and nothing else', () => {
  const approvalId = 'approval-one'
  expect(ApprovalDenyParams.parse({ approvalId, reason: '  Needs review  ' })).toEqual({
    approvalId,
    reason: 'Needs review'
  })
  expect(ApprovalDenyParams.safeParse({ approvalId, reason: 'a'.repeat(2000) }).success).toBe(true)
  for (const input of [
    { approvalId },
    { approvalId, reason: '   ' },
    { approvalId, reason: 'a'.repeat(2001) },
    { approvalId: '', reason: 'Needs review' },
    { approvalId, reason: 'Needs review', resolver: 'someone' },
    { approvalId, reason: 'Needs review', extra: true }
  ]) {
    expect(ApprovalDenyParams.safeParse(input).success).toBe(false)
  }
})
