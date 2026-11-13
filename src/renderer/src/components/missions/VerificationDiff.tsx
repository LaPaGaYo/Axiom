import { translate } from '@/i18n/i18n'
import type { VerdictDiff } from '../../../../shared/axiom-contract/verdict-record'

export function VerificationDiff({ diff }: { diff?: VerdictDiff }) {
  if (!diff) {
    return null
  }
  const lists = [
    {
      key: 'scopeViolations' as const,
      label: translate('missions.diffScope', 'Scope violations'),
      items: diff.scopeViolations
    },
    {
      key: 'dangerous' as const,
      label: translate('missions.diffDangerous', 'Dangerous changes'),
      items: diff.dangerous.map((item) => `${item.path} · ${item.pattern}`)
    },
    {
      key: 'secrets' as const,
      label: translate('missions.diffSecrets', 'Secret patterns'),
      items: diff.secrets.map((item) => `${item.path} · ${item.pattern}`)
    },
    {
      key: 'tampering' as const,
      label: translate('missions.diffTampering', 'Test tampering'),
      items: diff.tampering.map((item) => `${item.path} · ${item.rule} · ${item.count}`)
    },
    {
      key: 'generated' as const,
      label: translate('missions.diffGenerated', 'Generated files'),
      items: diff.generated
    },
    {
      key: 'binary' as const,
      label: translate('missions.diffBinary', 'Binary files'),
      items: diff.binary
    },
    {
      key: 'ignoredScopeEntries' as const,
      label: translate('missions.diffIgnoredScope', 'Ignored scope entries'),
      items: diff.ignoredScopeEntries
    }
  ]
  return (
    <section aria-labelledby="verification-diff-heading" className="space-y-2 text-xs">
      <h4 id="verification-diff-heading" className="text-sm font-medium">
        {translate('missions.diffGate', 'Diff gate')}
      </h4>
      {diff.error && <p className="font-mono text-destructive">{diff.error}</p>}
      {diff.changedPaths !== undefined && (
        <p className="tabular-nums">
          {translate('missions.diffChangedPaths', 'Changed paths: {{count}}', {
            count: diff.changedPaths
          })}
        </p>
      )}
      {diff.patchComplete !== undefined && (
        <p>
          {diff.patchComplete
            ? translate('missions.diffPatchComplete', 'Patch complete: Yes')
            : translate('missions.diffPatchIncomplete', 'Patch complete: No')}
        </p>
      )}
      {lists.map(({ key, label, items }) => {
        const total = diff.counts?.[key]
        if (!items.length && !total) {
          return null
        }
        return (
          <div key={key} className="space-y-1">
            <p className="font-medium">
              {label}
              {total !== undefined && total > items.length && (
                <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                  {translate('missions.diffFindingCount', '{{shown}} shown · {{total}} total', {
                    shown: items.length,
                    total
                  })}
                </span>
              )}
            </p>
            <ul aria-label={label} className="space-y-1">
              {items.map((item) => (
                <li key={item} className="break-all font-mono">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
