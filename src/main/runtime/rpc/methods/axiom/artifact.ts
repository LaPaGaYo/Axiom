import { defineMethod } from '../../core'
import {
  ArtifactPutParams,
  ArtifactReadParams,
  ArtifactListParams
} from '../../../../../shared/axiom-contract/artifact-params'
import { getAxiomControlPlane } from '../../../../axiom/control-plane'
import { resolveAttemptSender } from '../../../../axiom/execution/attempt-authority'
import { OrchestrationError } from '../../../orchestration/orchestration-error'

export const AXIOM_ARTIFACT_METHODS = [
  defineMethod({
    name: 'axiom.artifact.put',
    permission: 'workspace',
    params: ArtifactPutParams,
    handler: async (p, ctx) => {
      const { runtime } = ctx
      const { artifacts, store } = getAxiomControlPlane(runtime)
      const sender = p.attemptId
        ? resolveAttemptSender({
            runtime,
            store,
            db: runtime.getOrchestrationDb(),
            attemptId: p.attemptId,
            from: ctx.orchestrationCaller?.address ?? p.from ?? '',
            orchestrationCaller: ctx.orchestrationCaller,
            orchestrationCompatibilityEvidence: ctx.orchestrationCompatibilityEvidence
          })
        : undefined
      if (sender && sender.mission.id !== p.missionId) {
        throw new OrchestrationError(
          'task_dispatch_mismatch',
          'Artifact Mission does not match the Attempt.'
        )
      }
      return {
        artifact: await artifacts.put({
          ...p,
          ...(sender
            ? {
                createdBy: `attempt:${p.attemptId}`,
                related: [sender.binding.taskId, sender.dispatch.id]
              }
            : {}),
          content: Buffer.from(p.contentBase64, 'base64')
        })
      }
    }
  }),
  defineMethod({
    name: 'axiom.artifact.read',
    permission: 'workspace',
    params: ArtifactReadParams,
    handler: async (p, { runtime }) => {
      const { meta, content } = await getAxiomControlPlane(runtime).artifacts.read(p.id)
      return { meta, contentBase64: content.toString('base64') }
    }
  }),
  defineMethod({
    name: 'axiom.artifact.list',
    permission: 'workspace',
    params: ArtifactListParams,
    handler: (p, { runtime }) => ({ artifacts: getAxiomControlPlane(runtime).artifacts.list(p) })
  })
]
