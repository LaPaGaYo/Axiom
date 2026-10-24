const SECRET_PATTERNS = [
  {
    name: 'private_key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
  },
  // GitHub tokens use underscores; retain the specified hyphen forms as well.
  {
    name: 'provider_token',
    pattern: /\b(sk|ghp|gho|github_pat|xox[abp])[-_][A-Za-z0-9_-]{16,}\b/g
  },
  { name: 'aws_access_key_id', pattern: /\bAKIA[0-9A-Z]{16}\b/g }
]

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
