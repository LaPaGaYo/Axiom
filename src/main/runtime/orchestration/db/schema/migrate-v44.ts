import type { OrchestrationDb } from '../orchestration-db'
import { AXIOM_INDEXES_AND_DELETE_TRIGGERS_SQL } from './create-axiom-tables-sql'

export function migrateV44(this: OrchestrationDb, current: number): void {
  if (current >= 44) {
    return
  }
  // Why: createTables already supplies the side tables on every open, including v42 files.
  this.db.exec(AXIOM_INDEXES_AND_DELETE_TRIGGERS_SQL)
}
