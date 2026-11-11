import { describe, expect, it } from 'vitest'
import { parseDaemonPidFile, salvagePidFromCorruptDaemonRecord } from './daemon-pid-file-parse'

it('parses a legacy record only as a positive integer', () => {
  for (const record of ['', ' \n\t', '0', '-3', '1.5', '9007199254740992', 'Infinity']) {
    expect(parseDaemonPidFile(record), JSON.stringify(record)).toBeNull()
  }
  for (const record of ['1', ' 12345\n', String(Number.MAX_SAFE_INTEGER)]) {
    expect(parseDaemonPidFile(record)).toMatchObject({ pid: Number(record), launchNonce: null })
  }
  // Legacy validation must not change the JSON record contract.
  for (const pid of [0, -3, 1.5]) {
    expect(parseDaemonPidFile(JSON.stringify({ pid }))).toMatchObject({ pid })
  }
})

describe('salvagePidFromCorruptDaemonRecord', () => {
  it('salvages a pid whose digit run is terminated by a following byte', () => {
    expect(salvagePidFromCorruptDaemonRecord('{"pid":4242,"startedAtMs":17')).toBe(4242)
    expect(salvagePidFromCorruptDaemonRecord('{"pid": 4242, "startedAtMs"')).toBe(4242)
    expect(salvagePidFromCorruptDaemonRecord('{"pid":4242}')).toBe(4242)
  })

  it('refuses digits at end-of-bytes: a tear inside the digits leaves a different pid', () => {
    // Pid 42420 torn mid-digits — the surviving prefix 4242 must not be mistaken for a pid.
    expect(salvagePidFromCorruptDaemonRecord('{"pid":4242')).toBe(null)
    expect(salvagePidFromCorruptDaemonRecord('{"pid":4')).toBe(null)
  })

  it('refuses records with no usable pid field', () => {
    expect(salvagePidFromCorruptDaemonRecord('not a daemon record')).toBe(null)
    expect(salvagePidFromCorruptDaemonRecord('{"pid":0,"startedAtMs":17')).toBe(null)
    expect(salvagePidFromCorruptDaemonRecord('{"pid":-42,')).toBe(null)
  })
})
