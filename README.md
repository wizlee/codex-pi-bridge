# Pi workbench

Reinstall a pinned personal Pi setup, maintain the Codex-to-Pi bridge, and test upstream changes before switching installations. Windows x64 is the verified target.

The repository has two parts:

- `profiles/personal/` locks Pi, eight active packages, and portable preferences with a complete pnpm dependency lock.
- `src/` and `scripts/manage.mjs` provide the MCP bridge, native human approval forwarding, staged bridge upgrades, and rollback.

Node, pnpm, and Bun are pinned through mise. Conda is not needed for this Node toolchain. Existing Pi, credentials, settings, sessions, and saved project trust remain separate.

## Reinstall Pi

Install mise using its [official Windows instructions](https://mise.jdx.dev/installing-mise.html#windows). Review `mise.toml`, then run:

```powershell
mise trust
mise install
mise run setup
mise run env:plan
$piHome = Join-Path $env:LOCALAPPDATA 'pi-workbench/personal-2026-11-15'
mise exec -- pnpm run env restore --home $piHome
mise exec -- pnpm run env run --home $piHome
```

Choose a NEW directory outside this repository. Restore installs frozen dependencies with scripts disabled, generates local package paths, and checks the real runtime without model calls. It refuses an existing unowned directory. Repeating restore preserves local settings. A changed profile requires a new sibling environment, so the previous one remains available.

Open Pi through the same `env run` command. Log in with Pi's native `/login`, configure WakaTime yourself, review permission rules, and run `/ctx-doctor`. Bun is provided through mise; no separate Bun installer, Conda package, or editor restart is needed when using `mise exec`.

See [personal environment setup](docs/environment.md) for package choices, private settings, and environment rollback. Custom user skills and historical data are not silently copied.

## Add the Codex bridge

```powershell
$bridgeHome = Join-Path $env:LOCALAPPDATA 'pi-workbench/bridge'
mise exec -- pnpm run manage init --home $bridgeHome --environment $piHome
mise exec -- pnpm run manage stage --home $bridgeHome
```

Activate the printed SHA256 and register using [bridge setup](docs/setup.md). Fresh bridge installations allow read-only workers and disable tracing. Existing unowned MCP entries and edited policy blocks require reviewed migration. Native forms and real extension denial/approval must be personally checked before enabling writes.

## Maintain compatibility

```powershell
mise run updates
mise run test
mise run package
```

`updates` queries npm metadata without changing anything. [Repair upstream breakage](docs/upgrades.md) explains candidate branches, exact pins, frozen lockfiles, named qualification gates, native Codex checks, and rollback. Unknown future breaking changes can require code repairs. This repository provides the source, tests, diagnostic mode, and update workflow; it cannot promise automatic repair of arbitrary future APIs.

Windows CI installs the locked profile on a fresh runner and tests the actual packed bridge against it. It requires no provider credentials and makes no model calls. No updates or releases deploy automatically.

## Bridge behavior

Tools: `pi_discover`, `pi_delegate`, `pi_status`, `pi_wait`, `pi_follow_up`, `pi_cancel`, and `pi_approval_probe`. Supply absolute project paths and portable skills explicitly. Prefer multi-worker `pi_wait` with all remaining IDs and waits up to 60000 ms. Worker IDs belong to one server process. After restart or failure, inspect partial work and ask the user before rerunning. No worker replay occurs.

Read-only workers expose read, grep, find, and ls, excluding MCP tools. Extensions retain normal OS permissions; this is not an OS sandbox. Pi trust remains authoritative. The native adapter has no model-callable permission-answer tool. Empty automatic accepts fail closed.

Skill optimization requires recognized Responses payloads and complete native bodies matching the actual request catalog. Other shapes pass through. [Compatibility diagnostics](docs/compatibility.md), [maintenance](docs/maintenance.md), [design](docs/design.md), and [provenance](docs/provenance.md) describe the boundaries.

## Distribution

Public repository: [wizlee/pi-workbench](https://github.com/wizlee/pi-workbench). Credentials, sessions, memory databases, private permission rules, machine paths, node_modules, and third-party source are excluded. Dependencies are installed from their original packages with their own licenses. No reuse license is granted for this repository. `private: true` prevents npm publication; see `LICENSE`.
