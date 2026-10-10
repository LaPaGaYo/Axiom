import { expect, test as base } from './helpers/orca-app'
import { RecordingProxy } from './helpers/recording-proxy'

const vendorHosts = [
  'onorca.dev', // vendor-egress-ratchet: allow -- assertion data
  'orca.dev', // vendor-egress-ratchet: allow -- assertion data
  'stablyai', // vendor-egress-ratchet: allow -- assertion data
  'posthog', // vendor-egress-ratchet: allow -- assertion data
  'github.com', // vendor-egress-ratchet: allow -- assertion data
  'api.github.com', // vendor-egress-ratchet: allow -- assertion data
  'storage.googleapis.com' // vendor-egress-ratchet: allow -- assertion data
]

const test = base.extend<
  { captureEgress: void },
  { recordingProxy: { proxy: RecordingProxy; url: string } }
>({
  recordingProxy: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture arguments.
    async ({}, provideFixture) => {
      const proxy = new RecordingProxy()
      const url = await proxy.start()
      try {
        await provideFixture({ proxy, url })
      } finally {
        await proxy.close()
      }
    },
    { scope: 'worker' }
  ],
  orcaAppExtraArgs: async ({ recordingProxy }, provideFixture) => {
    await provideFixture([`--proxy-server=${recordingProxy.url}`])
  },
  orcaAppExtraEnv: async ({ recordingProxy }, provideFixture) => {
    await provideFixture({
      HTTP_PROXY: recordingProxy.url,
      HTTPS_PROXY: recordingProxy.url,
      ALL_PROXY: recordingProxy.url,
      NODE_USE_ENV_PROXY: '1',
      NO_PROXY: 'localhost,127.0.0.1,::1',
      ORCA_BACKGROUND_LAUNCH: '1'
    })
  },
  captureEgress: [
    async ({ recordingProxy }, provideFixture, testInfo) => {
      // Auto setup precedes the app launch; teardown includes app/daemon shutdown traffic.
      recordingProxy.proxy.recorded.length = 0
      try {
        await provideFixture()
      } finally {
        const tally = Object.fromEntries([...recordingProxy.proxy.hostTally()].sort())
        const body = JSON.stringify(tally, null, 2)
        await testInfo.attach('egress-host-tally', { body, contentType: 'application/json' })
        console.log(`[egress-host-tally] ${testInfo.title}\n${body}`)
        const forbidden = Object.keys(tally).filter((host) =>
          vendorHosts.some((vendor) => host.includes(vendor))
        )
        expect(forbidden, `Vendor requests in full host tally:\n${body}`).toEqual([])
      }
    },
    { auto: true }
  ]
})

test.describe('cold-start egress @egress-cold-start-golden', () => {
  test.describe('fresh onboarding', () => {
    test.use({ dismissOnboarding: false, seedTestRepo: false })

    test('fresh profile reaches onboarding then idles', async ({ orcaPage }) => {
      await expect(orcaPage.getByRole('heading', { name: /Pick your default agent/i })).toBeVisible(
        {
          timeout: 30_000
        }
      )
      // Deliberate observation window for startup timers and delayed background requests.
      await orcaPage.waitForTimeout(20_000)
    })
  })

  test('default profile reaches the main window then idles', async ({ orcaPage }) => {
    await expect(orcaPage.getByRole('button', { name: 'Explorer', exact: true })).toBeVisible()
    await expect(orcaPage.getByRole('heading', { name: /Pick your default agent/i })).toBeHidden()
    await orcaPage.waitForTimeout(20_000)
  })
})
