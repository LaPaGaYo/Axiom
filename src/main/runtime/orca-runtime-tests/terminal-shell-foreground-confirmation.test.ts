// The repository discovers .test.ts entrypoints; runtime fragments need the ordered harness.
export {}

await import('../orca-runtime-test-mocks.spec')
await import('../orca-runtime-test-lifecycle.spec')
await import('../orca-runtime-test-fixtures.spec')
await import('./terminal-shell-foreground-confirmation.spec')
