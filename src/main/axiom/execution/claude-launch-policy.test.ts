import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import {
  claudeManagedSettings,
  claudeManagedSettingsArg,
  claudeManagedSettingsSha256
} from './claude-launch-policy'

it.each(['planner', 'worker'] as const)(
  'pins the exact %s managed policy as inline JSON',
  (role) => {
    const expected = {
      strictPluginOnlyCustomization: true,
      disableAllHooks: true,
      disableSkillShellExecution: true,
      disableClaudeAiConnectors: true,
      disableRemoteControl: true,
      isolatePeerMachines: true,
      permissions: { disableBypassPermissionsMode: 'disable' },
      ...(role === 'worker' ? { sandbox: { enabled: true } } : {})
    }
    expect(claudeManagedSettings(role)).toEqual(expected)
    const arg = claudeManagedSettingsArg(role)
    expect(arg).toBe(JSON.stringify(expected))
    expect(arg).not.toMatch(/[\r\n]/)
    expect(JSON.parse(arg)).toEqual(expected)
    expect(claudeManagedSettingsSha256(role)).toBe(createHash('sha256').update(arg).digest('hex'))
  }
)
