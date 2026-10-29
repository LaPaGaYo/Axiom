import { redactContext } from '../context-builder/redaction'

/** Only a short diagnostic survives. Environment maps and assignments are never evidence. */
export function plannerDeniedInput(toolName: string, input: unknown): string {
  let summary: unknown = input
  if (input && typeof input === 'object') {
    if (toolName === 'Bash') {
      summary = 'command' in input ? input.command : ''
    } else if ('file_path' in input) {
      summary = input.file_path
    }
  }
  let text: string
  try {
    // Treat nested env-named fields as opaque, including casing and key variants.
    text =
      typeof summary === 'string'
        ? summary
        : (JSON.stringify(summary, (key, value: unknown) =>
            /env/i.test(key) ? '[REDACTED]' : value
          ) ?? '')
  } catch {
    text = '[unserializable input]'
  }
  // Shell assignment values can concatenate quotes, escapes, expansions and newlines.
  // Do not partially parse them: any equals sign makes the entire Bash summary opaque.
  // False positives (for example --format=) are preferable to leaking an env value.
  if (toolName === 'Bash' && text.includes('=')) {
    text = '[REDACTED environment assignment]'
  }
  return redactContext(text).content.slice(0, 200)
}
