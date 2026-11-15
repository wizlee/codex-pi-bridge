# Repair upstream breakage

This repository owns bridge source and its tests, a frozen personal Pi profile, and repeatable diagnostics. It does not automatically fix unknown future upstream APIs. Use candidate branches to diagnose and repair before changing the working installation.

## Inspect available updates

Run `mise run updates`. It queries official npm metadata for direct bridge dependencies, Pi/profile dependencies, pnpm, and Bun. It reports latest versions and deprecation notices without installing anything. Review Node releases separately; `nodePin` records the current pin. Review Codex desktop/CLI release notes separately because npm lockfiles cannot pin the Codex host. An observed CLI version does not qualify native desktop approval behavior.

For transitive dependencies, run these commands through mise:

```powershell
pnpm outdated
pnpm --dir profiles/personal outdated
pnpm audit
pnpm --dir profiles/personal audit
```

Treat registry/advisory failures as incomplete evidence. Do not print or commit private npm configuration. Update one contract or related group at a time.

## Build a candidate

1. Create a branch or separate checkout. Preserve uncommitted work and the live environment.
2. Update exact versions in the appropriate package manifest. Regenerate that lockfile with `pnpm install --lockfile-only --ignore-scripts`. Root dependencies use the root lock; Pi/extensions use `pnpm --dir profiles/personal install --lockfile-only --ignore-scripts`.
3. Restore to a NEW environment with `pnpm run env restore --home <candidate-home> --candidate`. This diagnostic mode runs real contracts against changed versions while leaving production compatibility pins unchanged. It cannot authorize activation or enable writes.
4. Run qualification against the generated candidate paths:

```powershell
$state = Get-Content '<candidate-home>/environment.json' -Raw | ConvertFrom-Json
mise exec -- pnpm run qualify --pi $state.piCli --agent $state.agentDir --permission $state.permissionPackage --candidate --report '<private-report-path>'
```

Named gates cover source/package constraints, MCP protocol and approval regressions, native skill expansion, actual provider serialization, effective optimization, permission registration, and normal discovery. Failures remain visible in the report. Keep reports private because errors can include local paths.

If restore itself fails, its generated runtime remains for inspection. `environment.json` is removed on a handled failure; use the paths under `<candidate-home>/runtime/node_modules/` and `<candidate-home>/agent/` for diagnosis. Retrying the same profile repairs incomplete setup. Do not fall back to the live installation to hide the failure.

## Repair the failed contract

| Upstream change | Inspect and repair | Proof |
| --- | --- | --- |
| Pi RPC/events | `src/rpc.mjs`, `src/bridge.mjs`, current Pi RPC docs | Add representative protocol regression and repeat real discovery |
| Native skill/catalog/provider payload | `src/worker-skill-loading.mjs`, `scripts/doctor.mjs`, installed Pi formatter/serializer | Actual payload qualification plus negative controls; preserve gated reads |
| Permission extension API or package layout | Permission registration, explicit package path, installed extension docs | Discovery plus personal real denial/approval; never disable protections |
| MCP SDK or Codex host | `src/server.mjs`, MCP client tests, official host release notes | Synthetic SDK tests plus personally visible native forms in target host |
| Node/pnpm/Bun | `mise.toml`, profile lock, platform assumptions | Fresh Windows restore, package, native dependency and context-mode checks |
| Other extension dependency | Its declared entries, loader errors, tools/commands and private data schema | Fresh discovery plus appropriate interactive functional check |

The doctor depends on private Pi implementation details to detect ineffective skill optimization. If those paths or hooks change, repair the adapter and its proof; changing only a version pin is not a repair. Unsupported production payloads continue to pass through without claiming optimization.

## Qualify and switch

After candidate contracts pass, review source changes and update `compatibility.json` with versions actually tested. Keep mise pins, profile dependencies, and lockfiles consistent. Run normal strict environment doctor and qualification without `--candidate`. Run `mise run package`, then `scripts/smoke.mjs --tarball <absolute-archive> --environment <candidate-home> --pnpm <absolute-pnpm-tool>` through mise. CI repeats fresh Windows restore and artifact smoke without credentials or model calls.

Personally verify target Codex forms, real extension denial/approval, and affected interactive extensions. No automated result grants human approval. Keep writes off until that check is complete. Stop clients and workers before bridge activation; retain the previous environment for rollback. Do not replay workers after failure or restart.

No automatic deployment, package self-upgrade, scheduled update, npm publication, or model benchmark is configured. Use the existing bridge maintenance guide for activation and rollback mechanics.
