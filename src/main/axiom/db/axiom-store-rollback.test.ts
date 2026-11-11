import { expect, it } from 'vitest'
import { mission } from '../../../shared/axiom-contract/contract-fixtures.test-support'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { AxiomStore } from './axiom-store'

it('an Axiom write transaction reports the SQLite error that ended it', () => {
  for (const nested of [false, true]) {
    const db = new OrchestrationDb(':memory:')
    try {
      const store = new AxiomStore(db)
      store.insertMission(mission)
      const before = store.getMission(mission.id)
      db.db.exec(`CREATE TEMP TRIGGER abort_mission_update BEFORE UPDATE ON missions
        BEGIN SELECT RAISE(ROLLBACK, 'database or disk is full'); END`)
      if (nested) {
        db.db.exec('BEGIN')
      }

      expect(() =>
        store.transaction('sqlite_rollback', () =>
          store.setActiveRevisions({ id: mission.id, activeGoalRevisionId: 'uncommitted' })
        )
      ).toThrow('database or disk is full')
      expect(db.db.isTransaction).toBe(false)
      expect(store.getMission(mission.id)).toEqual(before)
    } finally {
      db.close()
    }
  }
})
