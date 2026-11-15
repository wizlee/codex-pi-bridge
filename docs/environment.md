# Reinstall the personal Pi environment

The profile records the active setup observed on 2026-11-15, rather than replaying an old installation history. Exact versions are in `profiles/personal/package.json`; all resolved dependencies are in its pnpm lock. Node 26.13.0, pnpm 10.33.4, and Bun 1.3.14 are pinned in `mise.toml`.

| Package | Purpose | Decision |
| --- | --- | --- |
| context-mode | Context tools and continuity | Keep current 2.1.10; Bun available on PATH |
| @samfp/pi-memory | Memory/consolidation | Keep current 1.6.1; recreate data privately |
| pi-wakatime | Activity tracking | Keep 1.1.3; configure account key separately |
| @vanillagreen/pi-extension-manager | Package browser/settings | Keep active manager 3.0.6 |
| @vanillagreen/pi-caveman | Concise response controls | Keep 3.0.2 |
| @gotgenes/pi-permission-system | Permission enforcement | Keep 42.0.0; mandatory bridge check |
| @majorgilles/pi-grill-me | Planning interviews | npm 0.3.0 replaces mutable Git source |
| pi-autoresearch | Experiment workflows | Include active 1.9.0, absent from old notes |

`pi-extmgr` 0.3.0 remains installed globally on the observed machine but is absent from active Pi package settings. Do not install both managers by default. No old global package is removed by these scripts.

Pi supports [local package directories](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md). The installer uses those normal package declarations, with dependencies supplied by pnpm at one stable runtime pathname. No third-party source is vendored. The current Pi loader supplies legacy TypeBox aliases for extensions such as autoresearch; its legacy peer warning is recorded rather than resolved by installing another Pi SDK.

## Restore and launch

Follow the README setup. Use `pnpm run env plan` to review versions and public defaults, then `pnpm run env restore --home <new-absolute-directory>` through mise. Run `pnpm run env doctor --home <directory>` to recheck an existing environment. Run `pnpm run env run --home <directory> -- <Pi arguments>` to pass normal Pi arguments.

The environment directory contains:

- `runtime/`: frozen Pi and extension dependencies. Do not move it; Windows dependency junctions use absolute paths.
- `agent/`: private Pi settings, auth, trust, sessions, and extension data generated during normal use.
- `environment.json`: generated absolute runtime paths, used when pairing a bridge.
- `verified.json`: model-free setup result. It is not a human approval certificate.

These directories belong outside Git. Restore only writes a new or already-owned environment. It never takes over the current `~/.pi/agent`, changes Conda, installs global packages, or rewrites existing user preferences. Incomplete owned installs can be retried. A changed profile requires a new directory.

`env run` selects the private agent directory only for that process and holds a lifetime lock. Other standalone Pi commands keep their normal setup. Use the bridge's separate managed home for MCP; its `agentDir` selects the restored environment without changing global environment variables.

## Restore private state separately

The public defaults include provider/model/thinking choices, PowerShell availability, theme, disabled install telemetry, and memory consolidation model. They contain no auth or memory contents. Do not overwrite generated settings with an old full settings file: its package paths may refer to the old environment.

Log in through Pi normally. Configure WakaTime credentials through its native account flow. Review and recreate your permission rules and project trust personally. Fresh extension defaults do not reproduce old private hard-deny rules. Keep bridge writes disabled until the required human checks pass.

If restoring history, copy selected sessions, memory data, and custom instructions from a private backup while both environments are stopped. Inspect paths and extension schemas first. Keep old data intact; do not commit it here. Custom skills from `.agents` or the old Pi skills directory are separate resources and are not bundled by this profile.

The extension manager can browse packages and manage additional native Pi installations. For the locked baseline, change the profile and its lockfile, then build a new environment. Do not mutate `runtime/node_modules` or use bulk self-update commands as a substitute for qualification.

## Upgrade and return to the old environment

Create a candidate profile on a branch and restore it to a new directory. Keep existing environments untouched. To return to the previous standalone setup, run `env run` with its old directory, or use your unchanged original `pi` command.

To switch an existing managed bridge, stop all workers and the MCP client. Edit only its desired `piCli`, `agentDir`, and `permissionPackage` to the new environment's generated values, then activate. Activation captures the complete config. Bridge rollback restores the prior runtime selection together with bridge code. Old environments and private data remain available; no sessions or workers replay automatically.

Package initialization and resource discovery are automated checks. Interactive extension screens, context-mode functionality, Bun performance, WakaTime delivery, and personal approval enforcement still need their appropriate runtime checks. A claimed 3-5x Bun speedup is not a benchmark result for this setup.
