const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // GitHub tokens use underscores; retain the specified hyphen forms as well.
  /\b(sk|ghp|gho|github_pat|xox[abp])[-_][A-Za-z0-9_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g
]

export function redactContext(text: string) {
  let content = text
  for (const pattern of SECRET_PATTERNS) {
    content = content.replace(pattern, '[REDACTED]')
  }
  return { content, redacted: content !== text }
}
