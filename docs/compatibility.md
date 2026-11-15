# Compatibility checks

Verified platform: Windows x64. Exact tool and external prerequisite versions live in `compatibility.json`. Unknown Pi or permission-extension versions fail activation. Other platforms are unqualified even if some scripts run there.

```powershell
$env:PI_BRIDGE_PI_CLI = '<absolute Pi dist/bundle/cli.js path>'
mise run check:pi
```

The installed check uses real MCP stdio transport and model-free Pi discovery. Its doctor phase hashes existing standalone settings, AGENTS.md, trust decisions, and permission-extension config before and after. Normal Pi discovery can acquire trust-file locks and run extension startup code. It never auto-approves trust or answers dialogs.

`node scripts/doctor.mjs <absolute-pi-cli>` also verifies the installed package and permission-extension versions, runs Pi's actual native skill expander and system prompt formatter, then invokes its actual OpenAI Codex Responses serializer with a synthetic credential. The payload hook throws before transport. A localhost-only dummy endpoint prevents a provider request if the fixture contract changes. No real credentials are loaded by that serializer probe. Qualification must remove the unconditional skill-read hint and identify the complete native skill body. Unsupported or changed shapes fail this check instead of silently reporting optimization success.

This probe intentionally depends on private Pi module paths and the native skill expansion method in the tested version. Breakage means compatibility needs review. It does not certify every provider, tool, project extension, TUI feature, or future Pi version. Discovery requires the normal permission-system command. The current extension location check expects user-scoped Pi npm installation; other extension layouts require explicit qualification.

Model-free tests cover protocol safety, native-form forwarding with synthetic responses, multi-worker waits, provisional provider-error recovery, skill qualification, safe install defaults, registration preservation, lifetime locks, activation integrity, and code/config rollback. Synthetic responses never count as personal approval verification.

Symptoms and actions:

- Missing Pi path: resolve the real npm prefix and check the installed package.
- Unknown versions: install the tested versions or requalify a candidate. Do not bypass the check.
- Permission extension absent or wrong location: inspect Pi's normal package inventory and discovery. Do not disable extension safeguards.
- Trust lock access denied: run diagnostics with normal user filesystem access. Do not delete or rewrite trust decisions.
- Skill qualification failure: inspect changed native expansion, prompt catalog, hook, and Responses serializer. Keep pass-through behavior for unsupported production payloads.
- Locked managed home: finish and stop workers/client; inspect crash recovery guidance.
- Existing unowned MCP entry or edited policy: review migration manually. Installer preserves it by refusing.
