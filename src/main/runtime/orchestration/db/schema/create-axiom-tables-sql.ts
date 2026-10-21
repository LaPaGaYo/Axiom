// Why: widening a status CHECK requires rebuilding tables and breaks older binaries. Axiom
// enums are validated by axiom-contract at write boundaries; only D11's literal depth is pinned.
// Every side row carries mission_id so run cleanup survives prior Task/Dispatch deletion.
export function createAxiomTablesSql(): string {
  return `
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  run_id TEXT UNIQUE NOT NULL,
  coordinator_orca_session_id TEXT UNIQUE NOT NULL,
  repo_id TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  status TEXT NOT NULL,
  active_goal_revision_id TEXT,
  active_plan_revision_id TEXT,
  previous_status TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS goal_revisions (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  objective TEXT NOT NULL,
  constraints TEXT NOT NULL DEFAULT '[]',
  acceptance_criteria TEXT NOT NULL DEFAULT '[]',
  provenance TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(mission_id, revision)
);
CREATE TABLE IF NOT EXISTS plan_revisions (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  goal_revision_id TEXT NOT NULL,
  milestones TEXT NOT NULL DEFAULT '[]',
  risks TEXT NOT NULL DEFAULT '[]',
  -- v43 is unreleased: retain the validated proposal before Task materialization.
  proposal TEXT NOT NULL DEFAULT '{}',
  supersedes_id TEXT,
  rejected_reason TEXT,
  provenance TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(mission_id, revision)
);
CREATE TABLE IF NOT EXISTS task_stages (
  task_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  plan_revision_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  previous_stage TEXT,
  spec TEXT NOT NULL DEFAULT '{}',
  retry_policy TEXT NOT NULL DEFAULT '{}',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mission_task_edges (
  mission_id TEXT NOT NULL,
  from_task_id TEXT NOT NULL,
  to_task_id TEXT NOT NULL,
  readiness_threshold TEXT NOT NULL DEFAULT 'INTEGRATED',
  plan_revision_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(from_task_id, to_task_id)
);
CREATE TABLE IF NOT EXISTS agent_specs (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  role TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning TEXT NOT NULL DEFAULT '{}',
  permissions TEXT NOT NULL DEFAULT '{}',
  budget TEXT NOT NULL DEFAULT '{}',
  workspace_strategy TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  spec TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS attempt_bindings (
  task_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  branch TEXT NOT NULL,
  dispatch_id TEXT UNIQUE,
  agent_spec_id TEXT NOT NULL,
  context_package_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(task_id, seq)
);
CREATE TABLE IF NOT EXISTS context_packages (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  plan_revision_id TEXT NOT NULL,
  manifest TEXT NOT NULL DEFAULT '{}',
  token_budget INTEGER NOT NULL,
  mandatory_refs TEXT NOT NULL DEFAULT '[]',
  ranked_refs TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  dispatch_id TEXT UNIQUE NOT NULL,
  task_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  report TEXT NOT NULL DEFAULT '{}',
  checks_run TEXT NOT NULL DEFAULT '[]',
  limitations TEXT NOT NULL DEFAULT '[]',
  follow_ups TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  dispatch_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  tree_sha TEXT NOT NULL,
  status TEXT NOT NULL,
  superseded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(task_id, commit_sha)
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  media_type TEXT NOT NULL,
  related TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  resolution TEXT,
  authority TEXT NOT NULL,
  provenance TEXT NOT NULL DEFAULT '{}',
  supersedes_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS verification_runs (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  verdict_detail TEXT NOT NULL DEFAULT '{}',
  commands TEXT NOT NULL DEFAULT '[]',
  tool_versions TEXT NOT NULL DEFAULT '{}',
  verifier TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  runtime_epoch TEXT,
  claim_count INTEGER NOT NULL DEFAULT 0,
  worktree_id TEXT,
  started_at TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS integration_batches (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  candidate_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  merge_commit TEXT,
  conflicts TEXT NOT NULL DEFAULT '[]',
  approval_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  inputs_hash TEXT NOT NULL,
  risk TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  resolver TEXT,
  requested_by TEXT NOT NULL,
  resolution TEXT,
  outcome TEXT,
  executed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mission_policies (
  mission_id TEXT PRIMARY KEY,
  concurrency_limit INTEGER NOT NULL,
  budget TEXT NOT NULL DEFAULT '{}',
  readiness_threshold TEXT NOT NULL DEFAULT 'INTEGRATED',
  approval_rules TEXT NOT NULL DEFAULT '{}',
  verification_rules TEXT NOT NULL DEFAULT '{}',
  nested_worker_max_depth INTEGER NOT NULL DEFAULT 1 CHECK(nested_worker_max_depth = 1),
  -- // Why: v43 is unreleased; v42 opens create this whole table, so no ALTER TABLE is needed.
  unverifiable_tolerance_minutes INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  routing TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS audit_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  object_kind TEXT NOT NULL,
  object_id TEXT NOT NULL,
  event TEXT NOT NULL,
  before TEXT,
  after TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
${AXIOM_INDEXES_AND_DELETE_TRIGGERS_SQL}
`
}

export const AXIOM_INDEXES_AND_DELETE_TRIGGERS_SQL = `
CREATE INDEX IF NOT EXISTS idx_audit_events_object ON audit_events(mission_id, object_kind, object_id);

CREATE INDEX IF NOT EXISTS idx_task_stages_mission_stage ON task_stages(mission_id, stage);
CREATE INDEX IF NOT EXISTS idx_mission_task_edges_to_task ON mission_task_edges(to_task_id);
CREATE INDEX IF NOT EXISTS idx_goal_revisions_mission ON goal_revisions(mission_id);
CREATE INDEX IF NOT EXISTS idx_plan_revisions_mission_status ON plan_revisions(mission_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_events_mission_sequence ON audit_events(mission_id, sequence);
CREATE INDEX IF NOT EXISTS idx_candidates_task_status ON candidates(task_id, status);
CREATE INDEX IF NOT EXISTS idx_verification_runs_candidate ON verification_runs(candidate_id);
CREATE INDEX IF NOT EXISTS idx_verification_runs_status ON verification_runs(status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_integration_batches_mission_status ON integration_batches(mission_id, status);
CREATE INDEX IF NOT EXISTS idx_approvals_mission_status ON approvals(mission_id, status);

CREATE TRIGGER IF NOT EXISTS trg_tasks_delete_axiom
AFTER DELETE ON tasks
BEGIN
  DELETE FROM task_stages WHERE task_id = OLD.id;
  DELETE FROM mission_task_edges WHERE from_task_id = OLD.id OR to_task_id = OLD.id;
  DELETE FROM attempt_bindings WHERE task_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_dispatches_delete_axiom
AFTER DELETE ON dispatch_contexts
BEGIN
  UPDATE attempt_bindings SET dispatch_id = NULL WHERE dispatch_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_runs_delete_axiom
AFTER DELETE ON runs
BEGIN
  DELETE FROM goal_revisions WHERE mission_id IN (SELECT id FROM missions WHERE run_id = OLD.id);
  DELETE FROM plan_revisions WHERE mission_id IN (SELECT id FROM missions WHERE run_id = OLD.id);
  DELETE FROM task_stages WHERE mission_id IN (SELECT id FROM missions WHERE run_id = OLD.id);
  DELETE FROM mission_task_edges WHERE mission_id IN (SELECT id FROM missions WHERE run_id = OLD.id);
  DELETE FROM agent_specs WHERE mission_id IN (SELECT id FROM missions WHERE run_id = OLD.id);
  DELETE FROM attempt_bindings WHERE mission_id IN (SELECT id FROM missions WHERE run_id = OLD.id);
  DELETE FROM context_packages WHERE mission_id IN (SELECT id FROM missions WHERE run_id = OLD.id);
  DELETE FROM submissions WHERE mission_id IN (SELECT id FROM missions WHERE run_id = OLD.id);
  DELETE FROM candidates WHERE mission_id IN (SELECT id FROM missions WHERE run_id = OLD.id);
  DELETE FROM artifacts WHERE mission_id IN (SELECT id FROM missions WHERE run_id = OLD.id);
  DELETE FROM decisions WHERE mission_id IN (SELECT id FROM missions WHERE run_id = OLD.id);
  DELETE FROM verification_runs WHERE mission_id IN (SELECT id FROM missions WHERE run_id = OLD.id);
  DELETE FROM integration_batches WHERE mission_id IN (SELECT id FROM missions WHERE run_id = OLD.id);
  DELETE FROM approvals WHERE mission_id IN (SELECT id FROM missions WHERE run_id = OLD.id);
  DELETE FROM mission_policies WHERE mission_id IN (SELECT id FROM missions WHERE run_id = OLD.id);
  DELETE FROM audit_events WHERE mission_id IN (SELECT id FROM missions WHERE run_id = OLD.id);
  DELETE FROM missions WHERE run_id = OLD.id;
END;
`
