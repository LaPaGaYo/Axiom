import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const PROFILE_STATE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['profile', 'state', 'exports'],
    summary: 'List retained SQLite backups and JSON exports for profile-state recovery',
    usage: 'axiom profile state exports [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['profile', 'state', 'rollback'],
    destructive: true,
    summary:
      'Restore a SQLite backup or retained JSON export, or keep the current JSON or SQLite profile',
    usage:
      'axiom profile state rollback (--backup <id> | --revision <revision> | --current-json | --current-sqlite) [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'revision', 'backup', 'current-json', 'current-sqlite'],
    notes: [
      'Axiom must be stopped. Recovery validates the selected artifact and archives the current database family, JSON, and retained recovery artifacts before replacing state.',
      '--backup restores SQLite authority; --revision restores a JSON export for an older compatible runtime.',
      '--current-json keeps the current orca-data.json, including edits from an older build. It replaces SQLite state without merging; both copies are archived. The next SQLite-capable start imports the selected JSON.',
      '--current-sqlite keeps the current SQLite state and discards JSON edits from an older build. The JSON is archived, then rewritten from SQLite.'
    ],
    examples: [
      'axiom profile state exports',
      'axiom profile state rollback --backup <id>',
      'axiom profile state rollback --revision 1',
      'axiom profile state rollback --current-json',
      'axiom profile state rollback --current-sqlite'
    ]
  }
]
