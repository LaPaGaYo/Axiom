import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const network = vi.hoisted(() => ({ fetch: vi.fn(), openExternal: vi.fn() }))
vi.mock('electron', () => ({
  app: { isPackaged: true },
  net: { fetch: network.fetch },
  shell: { openExternal: network.openExternal },
  safeStorage: { isEncryptionAvailable: () => false }
}))

import {
  connectCurrentOrcaProfile,
  createCloudLinkedOrcaProfile,
  getCurrentOrcaProfileAuthStatus,
  refreshCurrentOrcaProfileAuth,
  selectCurrentOrcaProfileOrg,
  signOutCurrentOrcaProfile
} from './profile-cloud-service'
import { ensureActiveOrcaProfile } from './profile-index-store'
import { linkOrcaProfileToCloud } from './profile-cloud-index'
import {
  listOrcaProfileOrgMembers,
  inviteOrcaProfileOrgMember,
  revokeOrcaProfileOrgInvite,
  changeOrcaProfileOrgMemberRole,
  removeOrcaProfileOrgMember
} from './profile-cloud-org-members-service'

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'axiom-unconfigured-auth-'))
  vi.stubEnv('ORCA_CLOUD_API_URL', '')
  vi.stubEnv('ORCA_CLOUD_CLIENT_ID', '')
  vi.stubGlobal('fetch', network.fetch)
  vi.clearAllMocks()
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('packaged cloud without environment configuration', () => {
  it('does not request sign-in, refresh, org mutations, or logout even for a linked profile', async () => {
    const active = ensureActiveOrcaProfile(root)
    linkOrcaProfileToCloud(
      active.profile.id,
      {
        cloudProfileId: 'cloud-profile',
        userId: 'user',
        email: 'owner@example.test',
        linkedAt: 1
      },
      root
    )
    expect(getCurrentOrcaProfileAuthStatus(root)).toMatchObject({
      configured: false,
      state: 'unconfigured'
    })
    const operations = [
      connectCurrentOrcaProfile(root),
      refreshCurrentOrcaProfileAuth(root),
      createCloudLinkedOrcaProfile(root, { name: 'new-profile' }),
      selectCurrentOrcaProfileOrg(root, 'org'),
      listOrcaProfileOrgMembers(root, 'org'),
      inviteOrcaProfileOrgMember(root, {
        orgId: 'org',
        email: 'member@example.test',
        role: 'member'
      }),
      revokeOrcaProfileOrgInvite(root, { orgId: 'org', email: 'member@example.test' }),
      changeOrcaProfileOrgMemberRole(root, { orgId: 'org', userId: 'member', role: 'member' }),
      removeOrcaProfileOrgMember(root, { orgId: 'org', userId: 'member' })
    ]
    for (const operation of operations) {
      await expect(operation).resolves.toMatchObject({ status: 'unconfigured' })
    }
    await expect(signOutCurrentOrcaProfile(root)).resolves.toMatchObject({ status: 'signed-out' })
    expect(network.fetch).not.toHaveBeenCalled()
    expect(network.openExternal).not.toHaveBeenCalled()
  })
})
