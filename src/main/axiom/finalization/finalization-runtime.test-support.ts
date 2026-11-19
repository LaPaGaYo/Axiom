import { vi } from 'vitest'
import { OrcaRuntimeService } from '../../runtime/orca-runtime'
import * as scratch from '../integration/integration-scratch'
import * as merge from '../integration/integration-merge'
import { integrationHead, targetHead } from './finalization-fixture.test-support'

export function mockFinalizationGit(runtime = new OrcaRuntimeService()) {
  vi.spyOn(runtime, 'showRepo').mockResolvedValue({
    id: 'repo',
    path: '/repository',
    displayName: 'fixture',
    badgeColor: '',
    addedAt: 0
  })
  const readHead = vi.spyOn(scratch, 'readIntegrationHead').mockResolvedValue(integrationHead)
  const readGit = vi
    .spyOn(merge, 'readIntegrationGit')
    .mockImplementation(async (_cwd, args) => (args[0] === 'rev-parse' ? `${targetHead}\n` : ''))
  return { runtime, readHead, readGit }
}
