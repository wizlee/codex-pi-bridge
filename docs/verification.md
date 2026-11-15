# Workbench verification on 2026-11-15

Version 0.3.0 broadens the repository from bridge packaging to personal Pi reinstall and compatibility maintenance. The initial 0.2.0 bridge baseline passed 44 tests and a real extracted-artifact lifecycle smoke before this expansion.

Tested tools are mise 2026.11.8, Node 26.13.0, pnpm 10.33.4, and Bun 1.3.14 on Windows x64. The restored profile uses Pi 1.5.2 and eight active extension packages, including permission extension 42.0.0. Exact full dependencies are recorded in both pnpm locks.

Current verification:

- 51 regression tests cover inherited protocol/approval behavior, packaging lifecycle, isolated agent environment forwarding, profile preservation, runtime drift, failed update gates, and skill paths with spaces and URL-reserved characters.
- Fresh profile restore installed frozen dependencies without scripts into a new private workspace directory. Normal Pi discovery found the required extension commands and skills. Repeat restore reported unchanged and preserved settings.
- Strict named qualification passed source/package constraints, all regressions, and actual installed native skill expansion/provider serialization. No model calls.
- Grill Me npm 0.3.0 entrypoint hash matched the currently installed Git entrypoint.
- The update reporter queried official npm metadata without changing installed versions. It reported newer context-mode, pnpm, and Bun releases. These are update candidates, not automatically accepted versions.
- The release package includes the profile's complete lock and public defaults. The extracted-artifact smoke pairs the bridge with the isolated environment and checks actual MCP launch/discovery, safe defaults, external sessions, stopped-server enforcement, upgrade, and code/config rollback.
- Windows CI repeats frozen setup, package tests, fresh personal profile restore, and extracted-artifact smoke without credentials or model calls. Native desktop UI approval remains a separate personal check.

Repeat locally:

```powershell
mise run setup
mise run package
$piHome = '<new-absolute-private-directory>'
mise exec -- pnpm run env restore --home $piHome
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$archive = (Resolve-Path "dist/local-codex-pi-bridge-$version.tgz").Path
$pnpmTool = (mise which pnpm).Trim()
mise exec -- node scripts/smoke.mjs --tarball $archive --environment $piHome --pnpm $pnpmTool
```

Fresh-machine visible human approval/denial, interactive extension UI, context-mode execution, Bun performance, and WakaTime delivery were not claimed as automated proofs. The existing live bridge, standalone Pi settings, trust, sessions, and benchmark checkout were not replaced. Old worker IDs are never replayed. Public source contains no credentials or private state.
