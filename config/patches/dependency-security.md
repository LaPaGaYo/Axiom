# Dependency security fixes

These temporary patches cover advisories without a published fixed release.
Replace each patch with an upstream fixed version when available. Raw registry
audits continue to flag the original package versions; the patches do not rewrite
versions or suppress advisories.

| Package                         | Advisory            | Mitigation                                                                                                                                                       |
| ------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| braces 3.0.3                    | GHSA-vfj7-8cjw-p6xm | Bound brace and parenthesis nesting and recursive AST walkers to 128 levels. Reject excessive nesting with a controlled SyntaxError before exhausting the stack. |
| node-forge 1.4.0                | GHSA-86w9-cpqp-85rv | Require exactly the captured OID and optional NULL in the nested DigestAlgorithm sequence, rejecting unconsumed elements during RSA signature verification.      |
| sprintf-js 1.1.3                | GHSA-hp3w-g68c-fv3c | Clamp numeric precision to the ECMAScript range before formatting; protect both Node and browser entries.                                                        |
| minimatch 9.0.9, 10.2.5, 10.2.6 | GHSA-g3hv-75wg-m249 | Backport minimatch 11.0.1: stop `**/..` splitting at `braceExpandMax` patterns and skip pairwise dedupe above 1000 patterns.                                     |
| glob 13.0.6                     | GHSA-3g3m-2fjr-6pw4 | Backport glob 14.0.2: return after an abort instead of continuing the walk. Load the unbundled build so the patched walker and minimatch are used.               |

The braces patch applies to mobile, docs tooling, and isolated audit tools.
The minimatch and glob patches apply to the desktop workspace; minimatch 3.1.5 and 5.1.9
predate the vulnerable optimizer and need no patch. Upstream fixes ship only in minimatch 11
and glob 14, which change matching semantics and are not yet accepted by eslint or
electron-builder. Axiom took only the desktop half of the upstream backport (UPSTREAM-4b); the
copies installed by mobile, docs tooling and the isolated audit tools are not patched here.
Desktop no longer installs braces after removing the unused shadcn generator CLI.
The formatting patch applies to desktop and mobile; mobile's older sprintf-js
1.0.3 is first upgraded to 1.1.3. Mobile carries the RSA patch.
Mobile patch files stay inside its independent workspace for standalone builds.

`config/scripts/dependency-security-patches.test.mjs` exercises excessive numeric
precision in both installed desktop formatting entries, each desktop minimatch copy's `**/..`
limit, and glob abort. The mobile regressions in
`mobile/scripts/dependency-security-patches.test.ts` exercise deeply nested brace
and parenthesis patterns and direct AST inputs, then check the installed Expo
RSA dependency rejects a signed malformed DigestInfo while accepting a valid
signature. Both suites use the packages installed from the workspace lockfiles;
they do not run installs or access the registry. Normal patterns and formatting
retain their previous behavior. Excessive brace patterns now fail explicitly;
out-of-range numeric precision is clamped instead of throwing a RangeError.

Published fixes are used for DOMPurify, Hono, Markdown-it, Vite, Vitest, and path-to-regexp.
No development dependency is omitted from the audit.

The node-forge patch follows [upstream PR #1152](https://github.com/digitalbazaar/forge/pull/1152).
Remove it when an upstream release includes that fix.
