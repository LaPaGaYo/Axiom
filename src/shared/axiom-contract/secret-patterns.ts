export const SECRET_PATTERNS = [
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

/** Only names leave this detector. Each call uses fresh regexes, including global flags. */
export function detectBuiltInSecretPatterns(text: string): string[] {
  return SECRET_PATTERNS.filter(({ pattern }) =>
    new RegExp(pattern.source, pattern.flags).test(text)
  ).map(({ name }) => name)
}
