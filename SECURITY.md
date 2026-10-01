# Security Policy

n-dx runs an autonomous coding agent, serves a local web dashboard, and exposes
MCP servers to AI assistants. All three handle code, project plans, and agent
transcripts that are often confidential. This document says how to report a
weakness privately, what we treat as a vulnerability, and how maintainers handle
one from report to release.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security problem.** The
repository is public, so an issue publishes the gap before anyone can fix it.

Report privately through either route:

1. **GitHub private vulnerability report** (preferred):
   <https://github.com/en-dash-consulting/n-dx/security/advisories/new>.
   This opens a draft advisory that only maintainers can see.
2. **Email:** <nick@endash.us> with `[n-dx security]` in the subject line.

Include what you can of the following. A partial report is far better than none.

- The affected package(s) and version(s), or the commit on `main`.
- What an attacker can do, and what they need (a page the operator visits, a
  local process, a malicious repository, a crafted PRD item, …).
- Steps or a script to reproduce. `curl`, a short Node script, or a failing
  test are all fine.
- Any fix you have in mind. Not required.

You will get an acknowledgement within **3 business days** and a triage
decision (severity, whether we agree it is a vulnerability, and a rough fix
window) within **7 business days**. We will keep you updated as the fix moves
and credit you in the advisory and release notes unless you ask us not to.

## Supported versions

Fixes land on `main` and ship in the next release of the affected packages.
We backport only to the latest published minor line.

| Version | Supported |
|---------|-----------|
| Latest published `0.x` line on npm | Yes |
| `main` | Yes (fixes land here first) |
| Older minor lines | No, please upgrade |

All packages (`@n-dx/core`, `@n-dx/web`, `@n-dx/rex`, `@n-dx/sourcevision`,
`@n-dx/hench`, `@n-dx/llm-client`) are released together and share a version.

## What is in scope

n-dx's security model has a few load-bearing assumptions. Anything that breaks
one of them is a vulnerability we want to hear about.

**The dashboard and hub are reachable only from the operator, in their own browser or CLI.**
`ndx start` binds the per-user hub (port 3117) and every project server to
`127.0.0.1`. Two things stand between them and anyone else: the Host and
Origin rules, which tell a web page apart from the dashboard, and the
per-user token in `~/.ndx/auth.token` (mode 0600), which tells this user's
browser and CLI apart from another account on the same machine — loopback is
shared by every account on a host. Any way for a web page the operator merely
visits, or for another local account, to **read** dashboard data (PRD,
analysis, agent run records, configuration) or to **trigger** an action
(start or stop an agent, edit the PRD, change settings, spawn a process) is in
scope, regardless of the HTTP method or transport (fetch, WebSocket, MCP over
HTTP, DNS rebinding, and so on). Safe methods are not exempt: a `GET` that
leaks data or has a side effect counts. So is any way to obtain or bypass the
token, or to make the hub spawn something other than its own project server.

**The agent stays inside the project directory.** Hench's guard rejects path
traversal, null bytes and symlink escapes, blocks `.hench/`, `.rex/`, `.git/`
and `node_modules/`, allowlists shell executables and git subcommands, and
rejects shell metacharacters. A way to make the agent read or write outside
the project, modify its own guard configuration or PRD state through its
tools, or run a command the allowlist should have refused is in scope. This
includes prompt-injection paths (a crafted file, PRD item, or tool result)
when they cross a guard boundary.

**Repository configuration is reviewed before it is obeyed.** The files that
decide what n-dx may execute — the hench guard in `.hench/config.json`, the
test command in `.rex/config.json`, the servers in `.mcp.json` — are tracked
in the repository, so a clone or a pull request can widen them. Until the user
accepts a checkout's configuration (`ndx trust`), hench runs under the default
guard, `bypassPermissions` is lowered, and `verify_criteria` does not run the
repository's test command; the record of that acceptance lives in the user's
ndx home, not the repository. A way for repository content to widen execution
without that review, or to forge the review, is in scope. So is a secret
reaching `.hench/runs/` or the dashboard unredacted: run records and logs are
scrubbed of credential-shaped text, and the scrubbing is best-effort by
nature, so a reproducible miss is a welcome report.

**Secrets never leave their files.** API keys, CLI paths and other credentials
live in `.n-dx.local.json` (git-ignored) and in `.hench/config.json`. Dashboard
and MCP responses are meant to report *whether* a credential is configured,
never its value. Credentials appearing in an HTTP response, a run record, a
log, an exported bundle, or an analysis artifact are in scope.

**Server-side file access is confined.** Routes that read or serve files
(`/data/*`, git diffs, run records, static assets, the preview server) must
resolve inside the directory they serve. Path traversal, symlink escapes and
prefix-confusion on these routes are in scope.

**The supply chain stays readable.** Packages declare no install-time hooks
beyond `prepare`, and `pnpm security:obfuscation` rejects obfuscated code in
source and dependencies. A way to introduce code that bypasses these checks is
in scope.

## What is out of scope

- **The agent doing what it was configured to do.** Hench reads, writes and runs
  commands on purpose. Loosening `guard` in `.hench/config.json` is an operator
  decision; a report that the loosened configuration permits what it permits is
  not a vulnerability.
- **Running with `--no-auth` or `web.auth: false`.** Turning the per-user
  token off is an operator decision; what another local account can then do
  is the documented consequence, not a vulnerability.
- **Exposing a server beyond loopback.** Running the dashboard, hub or MCP
  endpoints behind a tunnel, a port-forward or on a non-loopback interface is
  unsupported. There is no authentication layer to defeat.
- **Attacks that require already running code as the operator's user.** A local
  process with the operator's privileges can read every file n-dx reads.
- **Vulnerabilities in LLM vendors or in the assistants that consume our MCP
  servers.** Report those upstream. We do want to know if n-dx *passes along*
  something it should have sanitised.
- **Denial of service against a loopback server** (large bodies, slow clients),
  unless it also crosses one of the boundaries above.

If you are unsure whether something qualifies, report it anyway. A quick "not a
vulnerability, but a good hardening idea" is a perfectly good outcome, and we
will file it as a normal issue with your permission.

## How maintainers handle a report

The same process applies whether the report arrives from outside or is found in
a review of our own code. Public repository means every step is chosen so the
gap is not described in public before the fix ships.

1. **Open a draft advisory first.** Security → Advisories → New draft, even for
   an internally found issue. The advisory holds the full write-up, the
   reproduction and the severity assessment. Nothing with that level of detail
   goes into a public issue, PR description, PRD item, commit message or chat
   log that is mirrored publicly.
2. **Track the work neutrally.** The PRD task and the PR carry a short,
   neutral title that names the change, not the attack (for example "Validate
   the Host header on dashboard requests", not "Fix DNS-rebinding data leak").
   Link to the advisory from the PR with a plain "see advisory" note. Reviewers
   who need the context are added to the advisory.
3. **Fix with tests.** Every fix lands with a test that reproduces the original
   gap and now fails without the fix. Security-relevant request handling lives
   in `packages/web/src/server/request-security.ts`,
   `packages/web/src/hub/request-guard.ts` and `packages/web/src/shared/origin.ts`;
   hench's guard lives in `packages/hench/src/guard/`. Prefer fixing in the
   shared helper so the hub and project server cannot drift.
4. **Ship as a patch release.** Add a changeset using the scoped package names
   (`@n-dx/web`, not `web`). The changeset text can be neutral too; the
   advisory is where the details live.
5. **Publish the advisory with the release.** Once the fixed version is on
   npm, publish the advisory with the affected version range, the fixed
   version, credit, and a CVE if the reporter wants one. Add a line to the
   release notes pointing at it.
6. **Review the class, not just the instance.** Before closing, check whether
   the same assumption is made elsewhere (the hub *and* the project server,
   the HTTP path *and* the WebSocket upgrade, every route that serves a file).
   File follow-ups for anything that shares the pattern.

Coordinated disclosure window: we aim to ship a fix within **90 days** of a
confirmed report, sooner for anything that leaks credentials or allows code
execution. If we cannot meet that, we will tell the reporter why and agree a new
date rather than go quiet.

## Hardening guidance for operators

- Keep `ndx start` on loopback. Do not tunnel or port-forward the dashboard or
  MCP endpoints to another host; nothing authenticates the other end.
- Keep credentials in `.n-dx.local.json` and never commit it. `ndx init` writes
  it as git-ignored; check `.gitignore` if you copied configuration by hand.
- Treat `.hench/runs/` as sensitive. Run records and transcripts contain
  everything the agent read and printed, which can include file contents and
  command output.
- Review `guard` settings in `.hench/config.json` before loosening them, and
  re-read the [Security section of the README](README.md#security) for what the
  defaults protect.
- Stop the hub when you are not using it (`ndx start stop`). A server that is
  not running has no attack surface.

Thank you for helping keep n-dx and its users safe.
