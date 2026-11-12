export function createAxiomSupervisionSql(): string {
  return `
CREATE TABLE IF NOT EXISTS supervision_settings (
  rule TEXT NOT NULL,
  mission_id TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL,
  mode TEXT,
  actor TEXT NOT NULL,
  provenance TEXT NOT NULL DEFAULT '{}',
  audit_sequence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(rule, mission_id, revision)
);
CREATE TRIGGER IF NOT EXISTS trg_missions_delete_supervision_settings
AFTER DELETE ON missions
BEGIN
  DELETE FROM supervision_settings WHERE mission_id = OLD.id;
END;
CREATE INDEX IF NOT EXISTS idx_audit_events_event_sequence ON audit_events(event, sequence);
`
}
