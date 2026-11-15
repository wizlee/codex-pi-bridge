# Codex to Pi bridge

Packaging candidate for the local Windows MCP bridge. Pi runs background workers with its normal trust, extensions, and human permission gates. Fresh installations allow read-only workers and disable request-shape tracing.

Windows x64 is the verified target. Other platforms are unqualified. Node, pnpm, Pi, and permission-extension versions are recorded in `compatibility.json`. Bridge dependencies are pinned in `pnpm-lock.yaml`; that lock does not pin your separate Pi installation.

## Set up development

Install mise using its [official Windows instructions](https://mise.jdx.dev/installing-mise.html#windows). Review `mise.toml`, then run these commands from this repository:

```powershell
mise trust
mise install
mise run setup
mise run check
mise run test
mise run package
```

Pins are Node 26.13.0 and pnpm 10.33.4. Packaging was verified with mise 2026.11.8. Tasks use pnpm directly, so a broken global Corepack shim does not need repair. `setup` uses the frozen lock and disables dependency install scripts. `package` reruns checks and tests, then creates a private tarball, SHA-256 file, and source manifest in `dist/`.

## Install or maintain

Read [fresh Windows setup](docs/setup.md), [upgrades and rollback](docs/maintenance.md), and [compatibility checks](docs/compatibility.md). Run management commands through `mise exec -- pnpm run manage`.

The installer never installs Pi, changes Pi trust, or copies your Pi settings. It refuses to take over an existing unowned `pi` MCP entry or edited managed policy. Keep the current installation intact until migration is explicitly reviewed.

## Runtime behavior

Tools: `pi_discover`, `pi_delegate`, `pi_status`, `pi_wait`, `pi_follow_up`, `pi_cancel`, and `pi_approval_probe`. Supply absolute project paths and relevant portable skills explicitly. Prefer multi-worker `pi_wait` with all remaining IDs and waits up to 60000 ms. Worker IDs exist only in one server process. Restart, failure, cancellation, and timeout require partial-work inspection and user direction before rerunning. The package never replays workers.

Read-only workers expose read, grep, find, and ls, excluding MCP tools. Extensions still run with normal OS permissions. This is a tool restriction, not an OS sandbox. Pi project trust remains authoritative. Open interactive Pi and use its trust controls yourself when project resources are intentionally required.

The native approval adapter has no model-callable answer tool. Empty automatic accepts fail closed. Fresh modifying workers must remain disabled until the user personally verifies native forms and real permission-extension denial and approval. Synthetic tests cannot prove human interaction.

Skill optimization applies only to recognized Responses payloads with complete native skill bodies matching the actual request catalog. Unsupported shapes pass through. Optional request-shape telemetry hashes user content and records shape metadata; it remains off by default. Keep any enabled sidecars private.

## Source and ownership

Imported from the deployed bridge described in [provenance](docs/provenance.md). No benchmark data, credentials, sessions, backups, machine config, Pi source, or permission-extension source is distributed. Source is published at [wizlee/codex-pi-bridge](https://github.com/wizlee/codex-pi-bridge). No reuse license is granted. The `private: true` package flag prevents npm publication; it does not control GitHub visibility. See `LICENSE`.
