import { describe, expect, it } from 'vitest'
import { resolvePushGatewayOrigin } from './push-gateway-origin'

describe('push gateway configuration', () => {
  it('is unconfigured without an environment override', () => {
    expect(resolvePushGatewayOrigin({}, true)).toBeNull()
    expect(resolvePushGatewayOrigin({}, false)).toBeNull()
  })

  it('preserves HTTPS overrides and development-only loopback HTTP', () => {
    expect(resolvePushGatewayOrigin({ ORCA_PUSH_GATEWAY_URL: 'https://push.example/' }, true)).toBe(
      'https://push.example'
    )
    expect(
      resolvePushGatewayOrigin({ ORCA_PUSH_GATEWAY_URL: 'http://localhost:4000' }, false)
    ).toBe('http://localhost:4000')
    expect(
      resolvePushGatewayOrigin({ ORCA_PUSH_GATEWAY_URL: 'http://localhost:4000' }, true)
    ).toBeNull()
  })
})
