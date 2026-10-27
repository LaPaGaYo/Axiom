export class ClaudeAccountRequiredError extends Error {
  readonly code = 'no_account'
  constructor() {
    super('No Claude account selected. Add a Claude account in Settings › Accounts.')
    this.name = 'ClaudeAccountRequiredError'
  }
}
