// Official-build identity is substituted at build time for diagnostics endpoint selection.
// Contributor builds receive null.
declare const ORCA_BUILD_IDENTITY: 'stable' | 'rc' | null
// Full commit the build was made from; official skill installs pin to it.
declare const ORCA_BUILD_COMMIT: string

// ORCA_LAYOUT_OWNER is declared in src/shared/layout-owner-switch.ts.
