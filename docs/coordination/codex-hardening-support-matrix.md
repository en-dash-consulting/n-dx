# Codex hardening support and acceptance matrix

This is a coverage contract, not a claim that every tuple works. PR 0 observed
only the installed macOS Codex CLI version `0.167.0-alpha.3.2` without logging in,
calling a model, changing credentials or testing native enforcement. All feature
rows below are **OPEN / evidence required**. The completed first-stack repairs
are regression baselines, not proof for new combinations.

## Coverage dimensions and tuple rule

For every advertised combination, record personal or company-provided existing
access; selected CLI path, version and provenance; macOS/Linux/Windows; login,
config and credential mode; canonical workspace; executor/reviewer role;
worktree Sidecar/hub; fresh/resume/fork; cancellation/restart; enforcement and
secret-isolation outcome. Attach PR/head/task and actual evidence links. Expand
the rows into concrete tuples when an owner knows the supported versions/configs;
do not mark a whole dimension covered by one happy path. Native unsupported
tuples get a tested actionable refusal. An advertised tuple without evidence is
unverified and its acceptance remains open.

| Coverage ID | Access/config/credential mode | CLI/OS/workspace | Role/surface and lifecycle | Required outcome/evidence | Gap owner |
| --- | --- | --- | --- | --- | --- |
| MCP-P | Existing personal CLI login, no API key; user config preserved | Selected CLI/version on each advertised OS; two sibling worktrees plus anchor | Executor and fresh distinct reviewer; fresh/resume/fork | Real CLI positive bound-root and negative sibling reads/writes/claims/logs; unrelated MCP excluded; fixture regression | PR 1 |
| MCP-C | Existing company CLI access, managed restrictions intact | Concrete selected managed binary/config; canonical assigned worktree | Executor/reviewer through session reuse | Same binding proof; no organizational trust bypass or alternate auth/provider | PR 1 binding; PR 5 managed-account evidence |
| POL-E | Personal/company CLI login; disposable credential canaries | Each admitted CLI version and native OS | Execution; fresh/resume/fork, Stop/retry/restart | Allowed and denied filesystem/symlink, network, shell/Git/tool actions via production path; unsupported requests refuse before spawn | PR 2 |
| POL-R | Same intended credential/policy envelope | Selected self-review and pair-review binaries/OS | Mandatory fresh distinct self-review; pair in both vendor directions where supported | Actual enforced reviewer boundary, missing report/refusal/cancel handling; no review or gate downgrade | PR 2 |
| SECRET | Existing login, user-exported canaries, configured selected-provider auth, broker-only headers | Temp ndx/config homes; real auth files never copied into fixtures | Executor/reviewer/Sidecar/hub; all lifecycle paths | Secrets absent from argv/logs/transcripts and agent shells; only intended provider receives credentials; approved minimum inheritance; no shared config edits | PR 2 policy; PR 5 provider proof |
| ID-P | Personal login/config/provider identity stable and deliberately changed | Selected binary/version drift; same and different canonical workspaces | Fresh/resume/fork/cancel/restart | Nonsecret fingerprint; correct reuse or explicit safe fresh/refusal; no identity crossing or false completion | PR 3 |
| ID-C | Existing company-managed login/profile/provider identity | Redacted concrete managed configuration and allowed workspace | Execution and Sidecar/hub continuity | Same identity guarantees without organization/user secrets in metadata | PR 3 mechanism; PR 5 account proof |
| EVENT | Existing CLI login; two turns reuse tool item ID, first interrupted | Current selected CLI and deterministic transcript fixture | Sidecar two-turn pairing and cancellation/restart | Current-turn result cannot attach to stale prior call; original unanswered call remains unanswered; native id-reuse observation distinguished from fixture | PR 3, `cde3b8f7` |
| HUB-MAC | Personal and managed CLI modes as advertised | Packaged install and actual selected admitted macOS CLI/version/digest | Hub and Sidecar, broker permission cards; fresh/resume/fork where supported, Stop/restart/host recovery | Real native positive broker/negative repo read/write/network/secret probes and actual browser approvals/cancel; no source-tree path assumptions | PR 4; managed proof PR 5 |
| HUB-LINUX | Same access/config modes | Linux packaged install, CLI/version and native sandbox capability explicitly identified | Same hub lifecycle | Native confinement/installation/browser proof or tested explicit refusal; no claim from macOS evidence | PR 4 |
| HUB-WINDOWS | Same access/config modes | Windows packaged install, spaces/quoting, CLI/version and native capability identified | Same hub lifecycle and restart/process cleanup | Windows-native proof or tested explicit refusal; Linux/macOS CI success is insufficient | PR 4 |
| MANAGED | Concrete existing company config: selected model/provider/profile/auth, deployment and organization controls | Actual selected CLI/version, OS and installation provenance | Execution/review, worktree Sidecar and admitted hub; all supported lifecycle modes | Redacted account-backed evidence; minimum trusted provider forwarding; unrelated hooks/apps/plugins/MCP excluded; helpers never execute merely from config; safe named refusals | PR 5 |
| AZURE | Existing authorized real Azure account/config; no new account/billing | Selected real CLI, actual account endpoint and deployment (redacted) | Codex Sidecar fresh/resume and required account criterion | Original `fc02c0b7` criterion: real Azure authentication via forwarded provider, no credential in argv. Local Responses/server mocks cannot satisfy it | PR 5, `fc02c0b7` |
| UX | Personal/company effective selections; supported or refused modes | Each supported tuple from prior owners | Capability/settings/help, tooling labels, browser and CLI | Actual effective vendor/model/provider/binary/version shown; known errors actionable; no catalog/default substitution for explicit pin | PR 6, `97acf4e3`, `5e12c9b2` |
| INTEGRATION | All advertised access/config/credential combinations | Exact final stack heads and environment tuples | Cross-feature execution/review/Sidecar/hub lifecycle | Audit all prior evidence and acceptance criteria; native/account/browser/fixture classes separate; required CI and review statuses honest | PR 6 |

## Evidence record

Each record contains coverage ID and concrete tuple, owning task, PR/base/head,
time, executable path/version and nonsecret provenance, OS, credential/login mode
without account secrets, command or browser flow, expected allowed/denied action,
observed result, artifact links and reviewer outcome. Label evidence as fixture,
real CLI against fixture provider, native boundary, browser, or actual account.
Distinguish requested policy, compiled arguments and observed enforcement.
Do not publish raw credentials, auth files, company identifiers or transcripts.

Statuses are OPEN, PASS, FAIL, UNSUPPORTED (tested refusal) and UNAVAILABLE
(missing evidence). A skipped test is UNAVAILABLE, never PASS. If a platform or
account is unavailable, identify exactly who must supply which evidence and keep
the corresponding criterion and dependent task open. Only the user can approve
substantive narrowing. The coordinator owns final integration/review scheduling;
the numbered owner owns production repairs and the evidence for its rows.
