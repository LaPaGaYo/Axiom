import type { OrchestrationDb } from '../orchestration-db'

export function migrateV45(this: OrchestrationDb, current: number): void {
  if (current >= 45) {
    return
  }
  // Why: createTables supplies these columns on fresh databases before migrations run.
  for (const [table, column] of [
    ['agent_specs', 'spec'],
    ['mission_policies', 'routing']
  ]) {
    if (!this.hasColumn(table, column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT NOT NULL DEFAULT '{}'`)
    }
  }
}
