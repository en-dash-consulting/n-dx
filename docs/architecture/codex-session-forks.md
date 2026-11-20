# Codex warm-parent forks

`n-dx work` probes the selected, trust-resolved Codex binary with the child
execution environment and working directory. It never substitutes another
`codex` found on PATH. The initial conservative version floor is 0.167; a
recognized version must also advertise `exec fork <SESSION_ID>` and its required
config/model/JSON flags. Probe failure or an unsupported surface explains the
fallback to cold sessions. Explicit batch and cold strategies do not probe.

Orientation uses a read-only sandbox, approval never, ignored user configuration,
disabled Apps/shell snapshots and per-server project MCP disable overrides.
Explicit user/profile model pins are copied into orientation overrides. Custom
providers fall back to cold until orientation can isolate their configuration.
Tasks use `exec fork`, never `exec resume` against the shared
parent. Each fork reapplies the task policy, model and shell credential hiding.
A missing child ID or one equal to the parent is a failure, evicts the parent,
and invokes the existing cold fallback. Follow-up turns use the child's ID.

The Codex parent cache additionally binds checkout/ref, execution policy, binary,
version, environment, Codex user/project config and credential-file identity. Only hashes
are persisted. Opaque keychain identity or missing observable credentials use
cold starts; unreadable identity files disable the optimization. Legacy caches
without this identity are misses. Sourcevision/model/vendor/age/fresh admission
checks remain in effect. Claude retains its historical parent admission across
unrelated sanitized child environment changes, and batch-chain admission is unchanged.

## Evidence, 2026-11-16

Reference: [official developer commands](https://learn.chatgpt.com/docs/developer-commands).

Installed CLI: `codex-cli 0.167.0-alpha.3.2`. `exec fork --help` advertised the
expected subcommand and flags. This is command-surface evidence only.

A disposable workspace with an isolated `CODEX_HOME` attempted parent creation
using `workspace-write`, approvals `never`, explicit credential-hiding overrides,
ignored user configuration/rules, and `gpt-6-astra`. Parent creation timed out at
25 seconds. That first attempt did not reach a fork.

A second isolated parent attempt timed out after 12 seconds but reported a
session ID. A promptless `exec fork` of that incomplete parent then exited 0,
reported a distinct child ID, created one new transcript, and left every
pre-existing transcript byte-for-byte unchanged. This is successful installed-CLI
storage-level fork evidence. The new transcript did not contain the orientation
marker; that early check did not verify completed orientation inheritance or
task/model turns. The authenticated follow-up below supplies orientation recall evidence.
No credentials were copied into the disposable homes.
A second disposable installed-CLI check confirmed that `mcp_servers={}` does
not stop a configured MCP server from starting. The implementation therefore
uses ignored user configuration plus the existing per-project disable mechanism.
A follow-up confined fixture with ignored user configuration and explicit disabled
server overrides did not start the marker server. This verifies that startup
control only, not fork or model behavior.

The completed authenticated follow-up created an orientation parent and forked
two children. Both children recalled the orientation marker, all three session
IDs were distinct, and the parent's transcript remained byte-for-byte unchanged.
This records the completed PR4 evidence supplied with the remediation task;
it is not a new live probe performed during remediation. The earlier timeouts
and incomplete-parent storage check above remain part of the historical record.
No browser flows or Windows live forks were tested.

`packages/llm-client/tests/integration/vendor-session.test.ts` uses scripted CLI
fixtures, not a real model. It covers selected-binary/version gating, fork then
child continuation, invalid child IDs and credential/config identity changes.
Adapter and orientation tests cover explicit task policy and read-only parent
creation. These tests are not a substitute for live transcript checks.

To repeat the authenticated check in a disposable workspace:
create a parent containing a unique orientation marker, snapshot its transcript,
fork two tasks, verify each reports a different ID and recalls the marker, and
compare the parent's transcript bytes after both tasks. Keep task sandbox
`workspace-write`, approvals `never`, credential hiding and an explicit model.
Do not relax confinement to obtain a passing result.

## Recorded PR4 validation

The original focused runs passed 84 llm-client tests, 212 Hench tests, and 238 root checks,
including the required cli-dev and scheduler-startup tests, architecture/domain
isolation and changeset policy.

The first affected gate passed root policy, Graview and Rex; root drift,
Hench, llm-client, Sourcevision and Web did not pass. That sandbox denied uptime,
process inspection and local socket binding; Web was interrupted after HTTP
fixture timeouts. Cold-strategy fixture assumptions found in that run were fixed
and passed scoped reruns.

The completed follow-up evidence supplied with this task records a passing fresh
heavy Astra review and a passing eight-suite affected gate: root policy, root drift,
Graview, Rex, Hench, llm-client, Sourcevision and Web. These are the original PR4
results, not a claim that this remediation has already passed its own fresh
review or outer gate. The gate and scripted tests do not extend the live evidence
to browser flows or Windows.
