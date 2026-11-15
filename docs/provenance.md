# Provenance and distribution review

The starting implementation was imported by allowlist from the existing local bridge. Installed config, sessions, dependencies, caches, backups, credentials, and Pi settings were excluded. `import-manifest.json` records hashes of imported source and tests before packaging edits.

Published runtime evidence:

- [Final report](https://github.com/wizlee/codex-native-vs-pi-benchmark/blob/b1be6952fddc3c09987d68f06c56b5e532504c4a/results/2026-11-14-integration-fixes/RESULTS.md)
- [Evidence commit](https://github.com/wizlee/codex-native-vs-pi-benchmark/commit/b1be6952fddc3c09987d68f06c56b5e532504c4a)
- [Deployed patch](https://github.com/wizlee/codex-native-vs-pi-benchmark/blob/b1be6952fddc3c09987d68f06c56b5e532504c4a/results/2026-11-14-integration-fixes/bridge-conditional.patch)

Prior observations were 39 bridge tests and one installed discovery check. They do not verify this package. The benchmark established no overall performance win. Durable worker recovery across process restart was not implemented.

Packaging changes add external runtime config and session paths, stricter startup validation, package-derived MCP version metadata, isolated releases, operator tooling, compatibility checks, and setup documentation. Core approval forwarding, trust behavior, permission enforcement, skill gates, and retry semantics remain inherited. Package verification is recorded separately in `verification.md`.

The user approved public GitHub visibility after a tracked-file and history review found no credentials, sessions, backups, or machine-specific paths. The repository is [wizlee/codex-pi-bridge](https://github.com/wizlee/codex-pi-bridge). `package.json` retains `private: true` to prevent npm publication and `license: UNLICENSED`. Public visibility does not grant a reuse license. The local source had no explicit distribution license; dependencies retain their own licenses.

Runtime dependencies are external packages resolved by pnpm: `@modelcontextprotocol/sdk`, `zod`, and `smol-toml`. Their licenses remain with their packages. Pi and the permission extension are separately installed prerequisites; neither source is copied here. Review transitive dependency notices before distribution. Generated tarballs contain bridge source only, with no bundled node_modules.
