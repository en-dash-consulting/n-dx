# Codex Sidecar selected-provider candidate

Task: `5d47b98c-517a-46c6-90be-2f4ed5d3434a`.

This candidate retains the existing hub executable/hash admission, permissions,
broker approvals and MCP backstop. It carries only the selected user-owned
provider, selected profile model and effective n-dx model pin. Session model
overrides n-dx Codex model, which overrides the user profile/top-level model.
Every Codex turn reconstructs the connection and resumes the recorded thread id.
Credential rotation is re-read; changes during preparation refuse the turn.
The provider id is retained in the session record: deleting or switching the
selected provider refuses that session, including after a server restart.

## Supported boundary

Custom providers require the selected CLI to report `0.167.0-alpha.3.2`.
Hub admission still additionally requires the exact audited macOS executable.
Only Responses endpoints are supported: HTTPS, or HTTP on loopback for local
providers. URLs with embedded credentials, query strings or fragments refuse.
The only supported query parameter is a non-secret Azure `api-version`.
Environment keys and environment headers are supported in both scopes. The audited
hub also accepts static headers and static bearer tokens. Worktree sessions refuse
static credentials because their shell can read the user configuration file.
Supported credentials are remapped to reserved child-only environment variables and blanked in agent
commands. Original environment names are removed from the CLI environment.
Exact environment-policy denials remain effective. Provider errors and
credential-bearing events are sanitized before transcript persistence.

Command-backed auth, gateway OAuth, custom-provider OpenAI login, model-catalog
endpoints and other unsupported selected settings refuse without executing a
helper or selecting OpenAI/Claude. Provider ids must be bare TOML keys. The
strict scanner ignores unrelated arrays of tables and refuses array tables in provider or selection settings; it never falls
back to a provider because parsing failed. This does not change model picker
catalog policy or add implicit opaque deployment-id support.

Configuration references checked 2026-11-18:
[reference](https://learn.chatgpt.com/docs/config-file/config-reference),
[advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced),
[gateway authentication](https://learn.chatgpt.com/docs/enterprise/connect-to-a-gateway?gateway-auth=api-key).
These document settings, not account access or host acceptance.

## Evidence and limits

`sidecar-custom-provider.test.ts` uses a mocked process boundary: it exercises
production config parsing, registry, driver argv, per-turn credential rotation,
model precedence, persisted resume, and transcript redaction. It is not actual
CLI/network evidence. `hub-codex-admission.test.ts` also pins propagation of
`llm.codex.model` when the hub record has no model. Existing confinement checks
remain separate in `codex-hub-confinement-evidence.md`.

After execution and independent review, a coordinator can run:

```sh
node packages/web/scripts/probe-sidecar-custom-provider.mjs /absolute/path/to/audited/codex .local_testing/pr9-provider-evidence
```

Build `@n-dx/llm-client` and `@n-dx/web` first. The probe uses built production
hub admission, registry and broker with the selected actual CLI. A disposable
loopback Responses service scripts a shell call and reply; no paid model or
operator provider account is used. Credentials are generated in memory, never
arguments or config values. It checks delivered models, fresh/live/restored
resume, an explicit session override, hidden shell credentials, broker/provider
header separation, unrelated MCP exclusion and artifact credential leakage.
It also scripts HTTP 401/503 failures and a missing credential to check distinct
auth and connection diagnostics without contacting any external provider.
Reports retain phase booleans and counts, not raw credential-bearing requests.
Every invocation has its own directory so failed attempts remain available.

The probe has not been run in this executor session (nested model launches are
prohibited). Real CLI protocol acceptance, new browser flows and paid provider
access therefore remain unverified. A passing scripted protocol probe does not
replace browser/card approval acceptance or independent review.

Executor limitations observed: the listener-based broker credential suite failed
with `listen EPERM` (and consequent setup/teardown errors). An initial built-server
check also refused a stale build while sources were still changing; final builds
and checks followed all source edits. Its retry then produced no answer line
from the server child; the existing helper discards stderr, so that retry's
underlying cause is not established. Neither failure is native-provider acceptance.

Completed executor validation:

- `@n-dx/llm-client` and `@n-dx/web` builds passed; web source/test typechecking passed.
- Foundation parser/user-config/session-driver/session suites: 126 tests passed.
- Web provider/admission/candidate/connected-tool contracts: 47 tests passed.
- Root architecture, domain isolation and changeset policy: 224 tests passed.
- Required `cli-dev` and `scheduler-startup`: 14 tests passed.
- Host probe syntax and `git diff --check` passed.

Three listener-dependent tests did not pass in this sandbox. Host execution,
fresh independent review and final acceptance remain coordinator work. No
task status transition, PRD mutation, staging, commit or publication was done
by this executor; the saved run context assigns those to Hench/coordinator.

## Protocol retry (run 921d5d5a)

Host acceptance remains **INCOMPLETE**. The retained retry instructions report
88 passing host listener tests across five files, but the actual CLI provider
probe failed to execute its shell check. Those host tests were not rerun here.
The earlier probe looked only at root `tools` and emitted `function_call`.
The installed CLI instead advertises `functions.exec` under developer
`additional_tools` input items and uses `custom_tool_call` / `custom_tool_call_output`.
The retained `pr9-browser-cli-boundary-custom-tools.json` confirms the call has
name `exec`, no namespace field, JavaScript input, and text-block output.

The standalone probe now discovers both advertisement formats, emits the
matching call and SSE item lifecycle, and checks unrelated namespace/leaf names
in both locations. Its shell command uses literal shell quoting and disables
login startup for `exec_command`. Shell evidence must come from the current
call id's textual output; historical markers, call inputs and non-text output
metadata cannot satisfy it. Production provider selection, admission, sandbox,
registry, broker, model pins and operator approvals were not changed.

Retry validation:

- Protocol tests: baseline 1 passed; new regressions initially 9 failed; final 10 passed.
- Protocol, required CLI startup/scheduler and changeset-policy run: 31 tests passed across four files.
- Web build and source/test typecheck passed.
- Standalone script syntax and whitespace checks passed.

These are synthetic protocol tests, not an actual installed-CLI acceptance run.
The coordinator must run the standalone command above natively after execution
and mandatory fresh distinct review. No nested models, subagents, paid provider
calls or native host probe were launched in this retry. Fresh review remains
pending; the executor cannot supply an independent review of its own patch.
Retain all prior failed artifacts and complete this same task only after the
fresh/resume/restart/model/auth/error/isolation phase checks pass on the host.
