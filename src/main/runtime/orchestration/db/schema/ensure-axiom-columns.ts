import type { OrchestrationDb } from '../orchestration-db'

// Upstream owns the numbered chain; nullable additions are transparent to older named-column reads/writes.
// Keep these unnumbered so the next upstream sync does not require renumbering Axiom steps again.
const AXIOM_COLUMNS = [['verification_runs', 'batch_id', 'TEXT']]

export function ensureAxiomColumns(this: OrchestrationDb): void {
  if (AXIOM_COLUMNS.every(([table, column]) => this.hasColumn(table, column))) {
    return
  }

  this.db.exec('BEGIN IMMEDIATE')
  try {
    for (const [table, column, definition] of AXIOM_COLUMNS) {
      if (!this.hasColumn(table, column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
      }
    }
    this.db.exec('COMMIT')
  } catch (error) {
    this.db.exec('ROLLBACK')
    throw error
  }
}
