import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { axiomClient } from '@/lib/axiom-client'
import { readVerdictRecord } from '../../../../shared/axiom-contract/verdict-record'

export function CheckOutput({ index, artifactId }: { index: number; artifactId?: string }) {
  const [state, setState] = useState<'closed' | 'loading' | 'ready' | 'error'>('closed')
  const [excerpt, setExcerpt] = useState<string>()
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current += 1
    },
    []
  )
  const toggle = async () => {
    const current = ++generation.current
    if (state !== 'closed') {
      setState('closed')
      setExcerpt(undefined)
      return
    }
    setState('loading')
    try {
      if (!artifactId) {
        throw new Error('missing_evidence')
      }
      const artifact = await axiomClient.readArtifact({ id: artifactId })
      if (
        artifact.meta.kind !== 'evidence' ||
        artifact.meta.mediaType.split(';')[0] !== 'application/json'
      ) {
        throw new Error('invalid_evidence')
      }
      const bytes = Uint8Array.from(atob(artifact.contentBase64), (character) =>
        character.charCodeAt(0)
      )
      const record = readVerdictRecord(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      )
      if (current !== generation.current) {
        return
      }
      setExcerpt(record.checks.find((check) => check.index === index)?.excerpt)
      setState('ready')
    } catch {
      if (current === generation.current) {
        setState('error')
      }
    }
  }
  return (
    <div className="space-y-2">
      <Button
        variant="link"
        size="xs"
        className="h-auto"
        disabled={state === 'loading'}
        aria-expanded={state !== 'closed'}
        onClick={() => void toggle()}
      >
        {state === 'closed'
          ? translate('missions.showCheckOutput', 'Show output #{{index}}', { index })
          : translate('missions.hideCheckOutput', 'Hide output #{{index}}', { index })}
      </Button>
      {state === 'loading' && (
        <p role="status" className="text-muted-foreground">
          {translate('missions.loadingEvidence', 'Loading evidence…')}
        </p>
      )}
      {state === 'ready' &&
        (excerpt ? (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground scrollbar-sleek">
            {excerpt}
          </pre>
        ) : (
          <p className="text-muted-foreground">
            {translate('missions.noCheckExcerpt', 'This Artifact holds no excerpt for this check.')}
          </p>
        ))}
      {state === 'error' && (
        <p className="text-muted-foreground">
          {translate('missions.excerptReadFailed', 'The evidence Artifact could not be read.')}
        </p>
      )}
    </div>
  )
}
