# Upgrade and roll back

Use a new candidate checkout or extract a verified private tarball. Run `mise install`, `mise run setup`, `mise run check`, and `mise run test`. Do not replace files inside an existing release folder.

1. Stop the existing managed MCP client before staging. All management operations share the lifetime lock. Run `mise exec -- pnpm run manage stage --home <absolute-managed-home>` from the candidate. Staging installs dependencies and tests an isolated copy. Its content hash identifies the release. Repeating a stage verifies and reuses identical staged source.
2. Finish workers, reconcile failures, and close the MCP client. The launcher holds an exclusive managed-home lock for the entire server lifetime. Activation, rollback, and registration refuse while it runs, including when workers are idle. This deliberately favors preservation over live replacement.
3. Review local desired `config.json`. Activation preserves its write gate and telemetry choice. Run `mise exec -- pnpm run manage activate --home <absolute-managed-home> --release <sha256>`. Compatibility failure leaves the active pointer unchanged.
4. Restart Codex desktop and check discovery. Repeat human approval checks after changes to Codex, Pi, permission extension, or approval handling.

Each activation creates an immutable history record containing the selected release and the exact active bridge config. One atomic `active.json` pointer selects that record. Sessions stay in the managed home's `sessions/`, shared across releases. Desired `config.json` is a separate operator-edited file. Editing it has no runtime effect until activation.

To revert, stop the bridge and run:

```powershell
mise exec -- pnpm run manage rollback --home <absolute-managed-home>
```

Rollback revalidates the prior source and installed Pi compatibility, then restores the prior code and active config together. It preserves newer desired config, unrelated Codex settings, sessions, and activation history. It does not downgrade Pi or its extensions. If those changed, restore their known compatible versions using their own tools before rollback. A second rollback follows history backwards; it does not toggle forward. No previous activation means rollback refuses.

## Recover an interrupted operation

Staging installs into an unverified content-addressed release folder. It writes `verified.json` only after all checks pass. Failed stages never change the active pointer. Repeating stage repairs and rechecks the same incomplete release. Windows pnpm dependency junctions contain absolute paths, so release folders must never move after dependency installation. Orphan history records are harmless; the active pointer remains authoritative.

Registration validates both proposed files before writing. A local journal records original and proposed bytes; ownership is saved before either file replacement. Repeating registration converges after interruption. If a user edits a managed block, registration refuses. Reconcile that block manually. Never copy an entire journal snapshot over newer unrelated changes.

A crashed launcher or manager leaves `.lock/`. Inspect its owner and child PIDs, all bridge/Pi processes, partial checkout work, and session files. A hard-killed launcher can leave child processes. No automatic unlock or replay occurs. After reconciling and confirming all related processes stopped, run:

```powershell
mise exec -- pnpm run manage unlock --home <absolute-managed-home> --reconciled true
```

Unlock also refuses if recorded owner or child PID exists. PID reuse can require manual recovery. An incomplete lock record requires manual inspection. The lock coordinates this managed home only; separate installations and desktop chats still need human coordination. Abrupt OS termination between child spawn and PID recording remains a manual recovery case.

The dependency-free launcher is installed once. If a future candidate changes it, `init` refuses to overwrite it. Review a stopped-server launcher migration separately. Do not delete history, releases, sessions, or recovery journals automatically.

## Disable or remove registration

Stop the bridge. In Codex config, disable the managed `pi` entry or remove its complete marked block. Remove only the marked delegation policy from AGENTS.md after reviewing user edits. Preserve unrelated text. Restart desktop. Keep managed sessions and journals private if archiving the home. Pi and its standalone settings need no rollback.

## Maintain a release

Update exact dependency pins and the pnpm lock together. Run the suite, installed runtime check, package task, and isolated extracted-artifact staging smoke. For Pi/provider changes, update compatibility pins only after the actual installed serializer qualification and normal discovery pass, then repeat relevant personal approval checks. Review `dist/` contents and provenance before any distribution. Review credentials, local data, dependency notices, and licensing before distributing future releases.
