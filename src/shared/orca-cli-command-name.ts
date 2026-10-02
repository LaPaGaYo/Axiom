export function getOrcaCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    return 'axiom'
  }
  if (platform === 'win32') {
    return 'axiom.cmd'
  }
  return 'axiom'
}
