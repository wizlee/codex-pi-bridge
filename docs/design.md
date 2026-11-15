# Workbench design

One repository owns a portable personal Pi profile and the Codex bridge that consumes it. The bridge keeps its original package name and source layout; the repository name is Pi workbench. A separate runtime package under `profiles/personal/` has its own complete dependency lock.

Considered shapes:

| Design | Benefit | Cost | Decision |
| --- | --- | --- | --- |
| Global npm/Conda plus sequential `pi install` | Familiar native commands | Global prefix drift, weak transitive reproducibility, in-place changes | Keep existing installation intact; do not replay it |
| Separate dotfiles and bridge repositories | Independent ownership | Coordinated version changes span repositories | Unnecessary for one personal compatibility baseline |
| One repo, locked side-by-side environments, separate bridge lifecycle | One reviewable version matrix; old runtime retained | Extra private environment directories | Chosen |

`environment.mjs` owns fresh installation and scoped launch. It generates settings only for a new owned environment and never imports live settings wholesale. Pi's normal local-package discovery loads extensions. Private auth, trust, data, and extra settings live in each environment's agent directory.

`manage.mjs` owns bridge staging, activation records, settings-preserving MCP registration, and rollback. A bridge config selects its Pi CLI, optional agent directory, and permission-package location. `PiRpc` passes the selected agent directory to child processes only. Read-only defaults, native human approval forwarding, and trust rules remain enforced.

Pi environments are never updated in place by the restore tool. Changed profiles require new directories, retaining old code and data. Bridge activation captures runtime selection and config together; rollback selects the prior environment without copying sessions or credentials. Windows dependency junctions require stable installation paths.

`updates.mjs` reports upstream versions without mutation. `qualify.mjs` keeps named failures and separates candidate diagnostics from strict activation. Candidate mode runs real contracts but never grants permission to activate unsupported versions. Windows CI verifies a credential-free fresh install and real packed MCP artifact.

The design makes future repair possible through maintained source and executable contracts. It does not promise to infer arbitrary future APIs, migrate unknown private data schemas, or certify interactive host UI behavior without human checks.
