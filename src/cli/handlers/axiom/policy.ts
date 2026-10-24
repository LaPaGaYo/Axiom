import type { CommandHandler } from '../../dispatch'
import {
  getRequiredStringFlag as required,
  getOptionalStringFlag as optional,
  getOptionalPositiveIntegerFlag
} from '../../flags'
import { PolicyResponseSchema } from '../../../shared/axiom-contract/policy-params'
import { readRoutingFile, readVerificationRulesFile } from './input-files'
import { callAxiom } from './rpc-command'

const formatPolicy = (value: unknown) =>
  JSON.stringify(PolicyResponseSchema.parse(value).policy, null, 2)

export const AXIOM_POLICY_HANDLERS: Record<string, CommandHandler> = {
  'mission policy show': async (ctx) => {
    await callAxiom(
      ctx,
      'axiom.policy.show',
      { missionId: required(ctx.flags, 'mission') },
      formatPolicy
    )
  },
  'mission policy update': async (ctx) => {
    const file = optional(ctx.flags, 'routing-file')
    const verificationFile = optional(ctx.flags, 'verification-rules-file')
    const concurrencyLimit = getOptionalPositiveIntegerFlag(ctx.flags, 'concurrency')
    await callAxiom(
      ctx,
      'axiom.policy.update',
      {
        missionId: required(ctx.flags, 'mission'),
        patch: {
          ...(file === undefined ? {} : { routing: await readRoutingFile(ctx.cwd, file) }),
          ...(verificationFile === undefined
            ? {}
            : { verificationRules: await readVerificationRulesFile(ctx.cwd, verificationFile) }),
          ...(concurrencyLimit === undefined ? {} : { concurrencyLimit })
        }
      },
      formatPolicy
    )
  }
}
