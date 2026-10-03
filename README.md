# Axiom

[![Repository](https://img.shields.io/badge/GitHub-LaPaGaYo%2FAxiom-181717?logo=github)](https://github.com/LaPaGaYo/Axiom)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platforms: macOS, Linux, Windows](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)

Axiom is a goal-driven autonomous software engineering control plane. It turns a user's Mission goal into a versioned plan and dependency-aware Task graph, coordinates specialized AI Agents working in isolated worktrees, independently verifies their submissions, and integrates approved results with evidence and human governance. It is not primarily an AI IDE, a multi-agent chat room, or a terminal launcher.

## Status

Pre-V1. M0 fork isolation is in progress. Axiom has no releases yet.

## Based on Orca

Axiom is a fork of [Orca](https://github.com/stablyai/orca), Copyright (c) 2026 Lovecast Inc., released under the [MIT License](LICENSE). Axiom reuses Orca's Execution Kernel for terminals, Git, worktrees, Agent sessions, and remote execution. See `NOTICE.md` for attribution and bundled third-party notices.

## Developing

Use Node.js 24 and the pnpm version declared in `package.json`.

```sh
pnpm install
pnpm dev
pnpm tc
pnpm test
pnpm lint
```

## Documentation

- [Project Charter](docs/PROJECT_CHARTER.md) — mission, scope, and non-goals
- [Architecture](docs/ARCHITECTURE.md) — system layers and boundaries
- [Project Constitution](docs/PROJECT_CONSTITUTION.md) — invariants and authority
- [Glossary](docs/GLOSSARY.md) — domain terminology

## License

[MIT](LICENSE). The upstream license is preserved unchanged. See `NOTICE.md` for attribution and [third-party notices](docs/site/THIRD_PARTY_NOTICES.md) for bundled components.
