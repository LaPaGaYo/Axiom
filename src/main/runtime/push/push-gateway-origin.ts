import { PRODUCT_EGRESS_POLICY } from '../../../shared/product-egress-policy'
import { cleanCloudServiceOrigin } from '../../../shared/cloud-service-url'

export function resolvePushGatewayOrigin(env: NodeJS.ProcessEnv, packaged: boolean): string | null {
  return (
    cleanCloudServiceOrigin(env.ORCA_PUSH_GATEWAY_URL, !packaged) ??
    PRODUCT_EGRESS_POLICY.pushGatewayOrigin
  )
}
