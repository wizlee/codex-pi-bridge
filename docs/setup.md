# Install the bridge on Windows

For the full personal Pi setup, first follow [environment setup](environment.md). Then use `manage init --environment <absolute-environment-home>` instead of resolving a global Pi CLI below. The remaining stage, activate, and register steps are identical. This guide also retains the supported existing-Pi route.

1. Install Git and mise using the [official Windows guide](https://mise.jdx.dev/installing-mise.html#windows). Clone [wizlee/pi-workbench](https://github.com/wizlee/pi-workbench) or verify and extract a release tarball. Read `mise.toml`, then run the development setup in the README.
2. Install `@earendil-works/pi-coding-agent@1.5.2` using Pi's normal installation process. Open interactive Pi, configure your provider yourself, and install `npm:@gotgenes/pi-permission-system@42.0.0` through Pi's package installer. Review the extension's rules. Do not copy another machine's credentials or trust store. This candidate expects the normal user-scoped npm extension location under the Pi agent directory.
3. Resolve your actual Pi CLI and choose a NEW managed bridge directory. The example generates the absolute CLI path from your npm prefix. It does not assume a username.

```powershell
$piPrefix = (npm prefix -g).Trim()
$piCli = Join-Path $piPrefix 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'
$bridgeHome = Join-Path $env:USERPROFILE '.codex/pi-bridge-managed'
$codexDir = Join-Path $env:USERPROFILE '.codex'
mise exec -- pnpm run manage init --home $bridgeHome --pi $piCli
mise exec -- pnpm run manage stage --home $bridgeHome
```

`init` generates local config with writes and tracing disabled. Repeating it preserves existing config. `stage` copies only package-allowlisted files, installs frozen dependencies without scripts, checks syntax and packaging constraints, and runs regression tests. It prints a release SHA256. It does not activate code or change Codex settings.

4. Close bridge clients. Activate the printed release, then register it:

```powershell
mise exec -- pnpm run manage activate --home $bridgeHome --release <printed-sha256>
mise exec -- pnpm run manage register --home $bridgeHome --codex $codexDir
```

Activation runs model-free checks against your installed Pi and extension before changing one atomic pointer. Registration appends a marked MCP table and delegation policy, preserving unrelated bytes. Existing unowned `pi` settings cause refusal. Review any migration manually; never restore an old whole-file backup over newer settings. Registration recovery journals stay locally under the managed home and must remain private.

5. Restart Codex desktop. Open a new chat. Run model-free discovery with your project's absolute directory. Saved Pi trust may exclude untrusted project resources; the installer never grants trust.
6. Personally run `pi_approval_probe` and answer Deny, then Allow once in visible native forms. Personally verify a real permission-extension read denial and approval. Before enabling writes, also verify a harmless write is denied without creating a file, then approved with the expected content. Keep hard-denied files protected. These human checks may require a deliberately authorized model smoke task; packaging tests do not make paid calls.
7. Only after those checks, explicitly approve and edit local `config.json` to enable writes. Stop the bridge, then activate the same release again to capture the new config. This installer has no command that grants approval or enables writes for you.

The MCP command captures the absolute Node executable used during registration. Keep that pinned mise Node installation available. Review and re-register after a Node migration. A non-default Pi agent directory can be selected through `PI_CODING_AGENT_DIR` in the launching environment.
