import { defineMethod } from '../../core'
import {
  ArtifactPutParams,
  ArtifactReadParams,
  ArtifactListParams
} from '../../../../../shared/axiom-contract/artifact-params'
import { getAxiomControlPlane } from '../../../../axiom/control-plane'

export const AXIOM_ARTIFACT_METHODS = [
  defineMethod({
    name: 'axiom.artifact.put',
    permission: 'workspace',
    params: ArtifactPutParams,
    handler: async (p, { runtime }) => ({
      artifact: await getAxiomControlPlane(runtime).artifacts.put({
        ...p,
        content: Buffer.from(p.contentBase64, 'base64')
      })
    })
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
