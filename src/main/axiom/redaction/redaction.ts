import { SECRET_PATTERNS } from '../../../shared/axiom-contract/secret-patterns'

export function redactContext(text: string) {
  let content = text
  for (const { pattern } of SECRET_PATTERNS) {
    content = content.replace(pattern, '[REDACTED]')
  }
  return { content, redacted: content !== text }
}

/** Only names leave this detector. Fresh regexes cannot retain a global lastIndex. */
export function detectSecretPatterns(text: string, extraSources: readonly string[] = []): string[] {
  return [
    ...SECRET_PATTERNS.filter(({ pattern }) => new RegExp(pattern.source).test(text)).map(
      ({ name }) => name
    ),
    ...extraSources.flatMap((source, index) =>
      new RegExp(source).test(text) ? [`policy:${index}`] : []
    )
  ]
}
