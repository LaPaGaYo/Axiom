import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodePairingUrl, extractPairingCodeFromUrl, parsePairingCode } from './pairing'
import type { PairingOffer } from './types'

const offer: PairingOffer = {
  v: 2,
  endpoint: 'ws://100.102.47.57:6768',
  deviceToken: 'token-abc',
  publicKeyB64: 'pubkey-xyz'
}

function encodeOffer(input: PairingOffer = offer): string {
  return btoa(JSON.stringify(input)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pairing deep links', () => {
  it('rejects the upstream scheme instead of treating it as an alias', () => {
    const url = `orca://pair?code=${encodeOffer()}`
    expect(extractPairingCodeFromUrl(url)).toBeNull()
    expect(parsePairingCode(url)).toBeNull()
  })

  it('extracts the QR pairing code from the hash payload', () => {
    expect(extractPairingCodeFromUrl('axiom://pair#abc123')).toBe('abc123')
  })

  it('extracts the pairing code from a query param', () => {
    expect(extractPairingCodeFromUrl('axiom://pair?code=abc123')).toBe('abc123')
  })

  it('accepts scanner casing and surrounding whitespace', () => {
    expect(extractPairingCodeFromUrl('  AXIOM://PAIR?code=abc123\n')).toBe('abc123')
  })

  it('rejects lookalike routes', () => {
    expect(extractPairingCodeFromUrl('axiom://pairing?code=abc123')).toBeNull()
    expect(extractPairingCodeFromUrl('axiom://pair-extra?code=abc123')).toBeNull()
  })

  it('prefers the query pairing code when both query and hash are present', () => {
    expect(extractPairingCodeFromUrl('axiom://pair?code=query-code#hash-code')).toBe('query-code')
  })

  it('ignores empty and unrelated URLs', () => {
    expect(extractPairingCodeFromUrl('axiom://pair')).toBeNull()
    expect(extractPairingCodeFromUrl('https://example.com/pair#abc123')).toBeNull()
  })

  it('decodes desktop QR payloads when atob requires base64 padding', () => {
    const realAtob = globalThis.atob
    vi.stubGlobal('atob', (input: string) => {
      if (input.length % 4 !== 0) {
        throw new Error('Invalid base64 length')
      }
      return realAtob(input)
    })

    expect(decodePairingUrl(`axiom://pair?code=${encodeOffer()}`)).toEqual(offer)
  })

  it('parses a full pairing URL and a bare copied code', () => {
    const code = encodeOffer()

    expect(parsePairingCode(`axiom://pair?code=${code}`)).toEqual(offer)
    expect(parsePairingCode(code)).toEqual(offer)
  })

  it('preserves a TLS reverse-proxy endpoint with an explicit port and path', () => {
    const proxiedOffer = {
      ...offer,
      endpoint: 'wss://proxy.example:443/orca/runtime'
    }
    const code = encodeOffer(proxiedOffer)

    expect(parsePairingCode(code)).toEqual(proxiedOffer)
  })
})
