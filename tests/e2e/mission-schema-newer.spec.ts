import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import { desktopCall } from './helpers/axiom-desktop-call'
import { git } from './helpers/axiom-fixture-mission'
import Database from '../../src/main/sqlite/sync-database'
import { MissionListResponseSchema } from '../../src/shared/axiom-contract/mission-params'

test('SCHEMA-2: a database a newer Axiom wrote is left alone and the app still works', async (// oxlint-disable-next-line no-empty-pattern -- The restart session owns the hidden app lifecycle.
{}, testInfo) => {
  test.setTimeout(180_000)
  const temp = mkdtempSync(path.join(os.tmpdir(), 'axiom-schema-newer-'))
  const session = createRestartSession(testInfo, { ORCA_BACKGROUND_LAUNCH: '1' })
  let app: ElectronApplication | undefined
  try {
    const repositories = [path.join(temp, 'first'), path.join(temp, 'second')]
    for (const repository of repositories) {
      git(['init', repository])
      git([
        '-C',
        repository,
        '-c',
        'user.name=Schema Test',
        '-c',
        'user.email=schema-test@example.invalid',
        'commit',
        '--allow-empty',
        '-m',
        'Initial commit'
      ])
    }
    const repoResult = z.object({ repo: z.object({ id: z.string().min(1) }) })
    const first = await session.launch()
    app = first.app
    await waitForSessionReady(first.page)
    repoResult.parse(await desktopCall(first.page, 'repo.add', { path: repositories[0] }))
    expect(
      MissionListResponseSchema.parse(await desktopCall(first.page, 'axiom.mission.list', {}))
        .missions
    ).toEqual([])
    await session.close(app)
    app = undefined

    const databasePath = path.join(session.userDataDir, 'orchestration.db')
    const db = new Database(databasePath)
    let stamp: Record<string, unknown> | undefined
    try {
      stamp = db.prepare('SELECT * FROM axiom_schema WHERE id = 1').get()
      expect(stamp).toMatchObject({ version: expect.any(Number) })
      db.prepare('UPDATE axiom_schema SET version = 99 WHERE id = 1').run()
    } finally {
      db.close()
    }

    const second = await session.launch()
    app = second.app
    const page = second.page
    await waitForSessionReady(page)
    await expect(desktopCall(page, 'axiom.mission.list', {})).rejects.toMatchObject({
      code: 'axiom_schema_newer'
    })
    repoResult.parse(await desktopCall(page, 'repo.add', { path: repositories[1] }))
    const missions = page.getByRole('button', { name: 'Missions', exact: true })
    await expect(missions).toBeVisible({ timeout: 30_000 })
    await missions.click()
    const alert = page.getByRole('alert').filter({ hasText: 'written by a newer Axiom' }).first()
    await expect(alert).toBeVisible({ timeout: 30_000 })
    await expect(alert).toContainText('axiom_schema_newer')
    await session.close(app)
    app = undefined

    const reopened = new Database(databasePath)
    try {
      expect(reopened.prepare('SELECT * FROM axiom_schema WHERE id = 1').get()).toEqual({
        ...stamp,
        version: 99
      })
      for (const table of ['missions', 'audit_events', 'axiom_effects']) {
        expect(reopened.prepare(`SELECT * FROM ${table}`).all()).toEqual([])
      }
    } finally {
      reopened.close()
    }
  } finally {
    try {
      await session.dispose(app)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }
})
