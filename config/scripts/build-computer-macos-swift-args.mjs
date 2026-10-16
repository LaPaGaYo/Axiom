export function detectsBuildSystemFlag(helpText) {
  return helpText.includes('--build-system')
}

export function swiftBuildArgs({ packagePath, triple, supportsBuildSystemFlag }) {
  const args = ['build', '-c', 'release', '--package-path', packagePath, '--triple', triple]
  if (supportsBuildSystemFlag) {
    // Why: swiftbuild shares an output directory across triples; lipo needs both binaries.
    args.push('--build-system', 'native')
  }
  return args
}
