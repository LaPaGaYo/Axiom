import type { OrchestrationDb } from '../orchestration-db'

export function migrateV46(this: OrchestrationDb, current: number): void {
  if (current >= 46) {
    return
  }
  for (const [column, definition] of [
    ['runtime_epoch', 'TEXT'],
    ['claim_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['worktree_id', 'TEXT'],
    ['started_at', 'TEXT'],
    ['finished_at', 'TEXT']
  ]) {
    // Fresh databases already received these columns from createTables.
    if (!this.hasColumn('verification_runs', column)) {
      this.db.exec(`ALTER TABLE verification_runs ADD COLUMN ${column} ${definition}`)
    }
  }
}
