# Packaging design

Usage is `init`, `stage`, `activate`, `register`, then `rollback` when needed. All paths are explicit and absolute. The repository and live managed home are separate.

The release owns source, tests, scripts, docs, templates, and dependency metadata. `inventory()` derives a deterministic content ID from the package allowlist. Staging installs dependencies at the final release pathname, then writes an atomic verification marker after checks pass. Windows pnpm junctions require that stable pathname. Unverified releases cannot activate.

The managed home owns local desired config, release folders, sessions, history, registration journals, and a stable launcher. The launcher reads one active record and supplies its config through `PI_BRIDGE_CONFIG`. `Bridge` keeps extensions relative to release source while storing sessions in the external configured directory.

Activation and rollback own pointer transitions. Registration owns only explicitly marked text blocks. It parses TOML to detect alternate spellings of existing MCP keys, then patches original text without serializing unrelated settings. Edited or unowned blocks require manual review.

An in-place updater was rejected because interrupted copies could mix source generations and lose user state. A symlink-based current directory was rejected because Windows permissions and open handles complicate replacement. Immutable release directories plus an atomic JSON pointer need no symlink privilege and preserve prior generations.

The exclusive directory lock covers all management mutations and the full launcher lifetime. It is conservative, local to one managed home, and never breaks itself automatically. Worker coordination across installations remains an operator responsibility. No worker replay, persistence, provider benchmark, or public publishing system is added.
