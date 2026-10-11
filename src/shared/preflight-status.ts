// checked=false means authentication was deliberately not probed in this profile.
// Omission preserves compatibility with older runtimes that always checked auth.
export type PreflightStatus = {
  git: { installed: boolean }
  gh: { installed: boolean; authenticated: boolean; checked?: boolean }
  /** Optional — older preload payloads predating GitLab support omit it; consumers gate on `glab?.installed`. */
  glab?: { installed: boolean; authenticated: boolean; checked?: boolean }
  bitbucket?: {
    configured: boolean
    authenticated: boolean
    checked?: boolean
    account: string | null
  }
  azureDevOps?: {
    configured: boolean
    authenticated: boolean
    checked?: boolean
    account: string | null
    baseUrl: string | null
    tokenConfigured: boolean
  }
  gitea?: {
    configured: boolean
    authenticated: boolean
    checked?: boolean
    account: string | null
    baseUrl: string | null
    tokenConfigured: boolean
  }
}
