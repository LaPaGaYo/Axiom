# @axiom/docs

This package contains the product documentation and public media intended to
ship alongside Axiom's source code.

Documentation for [Axiom](https://github.com/LaPaGaYo/Axiom), served at `/docs`.
The pages are inherited from Orca and are being revised for Axiom.

This package is a **self-contained Next.js app**. It is intentionally **not** a root monorepo workspace member, so installing Electron app dependencies does not pull Next/fumadocs.

## Local development

Use Node.js 24 and the pnpm version pinned in `package.json`. CI reads the
Node.js version from this package's `engines.node` field.

```bash
cd docs/site
pnpm install
pnpm dev
```

Open [http://localhost:3004/docs](http://localhost:3004/docs).

## Linting

Run `pnpm lint` inside this directory. The isolated Oxlint
configuration keeps the native equivalents of the previous Next.js, React,
React hooks and accessibility checks at their existing severities, including
alt text on Next.js `Image` components. Generated Next.js and MDX output is
excluded. Oxlint also reports its default correctness warnings.

The migration does not provide equivalents for React's deprecated-API check,
React Compiler configuration/gating diagnostics, or Next.js's relative
`location.assign` advisory. JSX variable-use bookkeeping is handled by Oxlint's
parser. Keep TypeScript and the production Next.js build in the validation
workflow; this is not a claim of complete ESLint rule parity.

## Production build

```bash
cd docs/site
pnpm install
pnpm build
pnpm start
```

`pnpm start` serves the production build on port 3004. Paths:

| Path               | Purpose                              |
| ------------------ | ------------------------------------ |
| `/`                | Redirects to `/docs`                 |
| `/docs`            | Docs index                           |
| `/docs/...`        | Nested doc pages from `content/docs` |
| `/docs/api/search` | Fumadocs search index                |
| `/docs/og/...`     | Per-page Open Graph image route      |

## Layout

- `content/docs/` — MDX pages + `meta.json` navigation
- `public/docs/` — docs-only media, logo, and favicon (GIFs, posters, screenshots)
- `src/app/docs/` — fumadocs routes, OG images
- `src/components/` — docs-scoped chrome (header/footer/search), not marketing site

## Updating content

Treat the documentation tree as a deliberate publication boundary. Before
importing source material, review the diff for internal references, credentials,
third-party media rights, and feature/version claims, then copy only approved
pages and assets. Keep the app shell and deployment configuration in this
repository so a docs-only pull request can be reviewed and built independently.

## Hosting

Axiom has no published documentation host yet. The inherited app serves `/docs`
and uses `/docs-static` for Next.js assets. Deployment configuration remains
inherited and needs review before publishing; upstream hosting instructions do
not apply to Axiom.

## Versioning

`versioning.config.ts` keeps the current unversioned `/docs` URLs stable while
reserving `content/versions/<id>` for future snapshots. Versioned routes are not
live yet; when they are needed, add the corresponding loader/routes and a
version entry. The release workflow can then deploy them without a trigger
change.

## Isolation from the desktop app

- Own `package.json` + `pnpm-lock.yaml` under `docs/site/`
- Not listed in the root `pnpm-workspace.yaml`; its own `pnpm-workspace.yaml` makes it a separate workspace root and holds its pnpm settings, which pnpm 12 ignores under `--ignore-workspace`
- Engineering notes remain in repo-root `docs/` — do not confuse with this package
