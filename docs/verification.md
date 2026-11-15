# Verification on 2026-11-15

Windows x64 candidate. Tools: mise 2026.11.8, Node 26.13.0, pnpm 10.33.4. Installed prerequisites: Pi 1.5.2 and permission extension 42.0.0.

Passed checks:

- `mise run setup`: frozen pnpm dependency installation with scripts disabled.
- `mise run check`: release allowlist, JavaScript syntax, private metadata, and machine-path scan.
- `mise run test`: 44 tests, including 39 inherited protocol/approval/skill regressions and five packaging lifecycle tests.
- `mise run check:pi` with `PI_BRIDGE_PI_CLI`: installed native skill expansion, actual provider serialization and effective qualification, normal Pi discovery, configuration preservation, and real MCP stdio discovery. No model calls.
- `mise run package`: private allowlist tarball with exact package-manager pin, source manifest, and SHA256.
- `scripts/smoke.mjs`: extracted-artifact allowlist, fresh defaults, repeated staging, real managed MCP launch, write-gate rejection before submission, external session location, lifetime-lock activation refusal, second-release upgrade, code/config rollback, and idempotent temporary Codex registration. No live registration or model calls.

Repeat the artifact smoke after packaging:

```powershell
$archive = (Resolve-Path 'dist/local-codex-pi-bridge-0.2.0.tgz').Path
$pnpmTool = (mise which pnpm).Trim()
mise exec -- node scripts/smoke.mjs --tarball $archive --pi $env:PI_BRIDGE_PI_CLI --pnpm $pnpmTool
```

The smoke modifies only temporary candidate homes and removes them afterward. It deliberately tests an upgrade by appending a fixture line to the extracted README. It does not alter the installed bridge, benchmark checkout, live Codex registration, provider settings, or saved trust.

Two defects were found by the actual artifact test and fixed: pnpm 10 pack strips the package-manager pin, so private release assembly uses the explicit allowlist; Windows pnpm dependency junctions break when moved, so staging installs at the final release pathname and writes verification last.

Fresh-machine visible human approval and denial were not repeated. Existing human baseline remains historical. New installations stay read-only until the operator personally verifies native forms and real extension enforcement. This verification does not qualify other operating systems, providers, versions, or extension locations. No public publication or live deployment occurred.
