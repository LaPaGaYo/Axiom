# @axiom/docs

This package contains the product documentation and public media intended to
ship alongside Axiom's source code.

Documentation for [Axiom](https://github.com/LaPaGaYo/Axiom), served at `/docs`.
The pages are inherited from Orca and are being revised for Axiom.

This package is a **self-contained Next.js app**. It is intentionally **not** a root monorepo workspace member, so installing Electron app dependencies does not pull Next/fumadocs.

## Local development

```bash
cd docs/site
pnpm --ignore-workspace install
pnpm --ignore-workspace dev
```

Open [http://localhost:3004/docs](http://localhost:3004/docs).

## Production build

```bash
cd docs/site
pnpm --ignore-workspace install
pnpm --ignore-workspace build
pnpm --ignore-workspace start
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
- Not listed in the root `pnpm-workspace.yaml`; install with `pnpm --ignore-workspace`
- Engineering notes remain in repo-root `docs/` — do not confuse with this package
