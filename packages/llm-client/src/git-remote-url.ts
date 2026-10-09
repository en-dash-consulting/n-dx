/**
 * Parsing a git remote URL, in one place for the whole monorepo.
 *
 * Three readers need the origin remote for different reasons — the iso export
 * turns it into browsable source links, the analysis manifest records it as the
 * repository's identity, and the dashboard shows the repository's name — and
 * they must agree on what the remote says. Each had grown its own regex, which
 * is how `git@host:owner/repo.git` came to mean three slightly different things
 * depending on who was asking.
 *
 * Pure string work: nothing here runs git, touches the filesystem or reaches
 * the network. Reading the remote stays with whoever owns the process boundary
 * (`sourcevision/util/git-remote.ts` runs `git config`; web's project route
 * uses `exec`); only the interpretation of the string lives here.
 *
 * Host-neutral by construction. The host is whatever the remote names, so
 * GitHub, Bitbucket Cloud, Bitbucket Data Center, GitLab and a self-hosted Gitea
 * all parse the same way; `kind` is a narrowing on top of that for the callers
 * that must build a host-specific URL, never a gate on parsing.
 *
 * @module llm-client/git-remote-url
 */

/**
 * Which hosting product serves a remote.
 *
 * Only the three the product has host-specific behaviour for are named. Every
 * other host — GitLab, Gitea, a bare git daemon — is `other`: an honest "we did
 * not recognise this" rather than a guess, because a caller that branches on a
 * wrong `kind` builds a URL that 404s.
 */
export type RemoteHostKind = "github" | "bitbucket-cloud" | "bitbucket-dc" | "other";

/** A git remote URL split into the parts that identify a repository. */
export interface ParsedGitRemote {
  /** Host only — no scheme, credentials or port: `github.com`, `bitbucket.example.com`. */
  host: string;
  /**
   * The namespace owning the repository, with no leading or trailing slash.
   *
   * Called an owner or organisation on GitHub, a workspace on Bitbucket Cloud
   * and a project key on Data Center; one field, because every host puts it in
   * the same position. Nested namespaces (GitLab subgroups) keep their slashes,
   * so `owner` + `/` + `repo` is always `path`.
   */
  owner: string;
  /** Repository name, with any `.git` suffix removed. */
  repo: string;
  /**
   * `owner/repo` — the repository's identity on its host.
   *
   * Data Center's `/scm/` clone prefix is a routing artifact rather than part of
   * the identity, so it is stripped: `https://bb.example.com/scm/PROJ/widget.git`
   * has the path `PROJ/widget`.
   */
  path: string;
  /** Which hosting product serves `host`. */
  kind: RemoteHostKind;
}

/** A remote split into host and the path as written, before any interpretation. */
interface RawRemote {
  host: string;
  /** Path segments as the remote spelled them, `.git` and empty segments removed. */
  segments: string[];
}

/**
 * Drop the userinfo from a scheme-bearing remote URL.
 *
 * A remote such as `https://user:token@github.com/acme/widget.git` carries a
 * live credential, and `.sourcevision/manifest.json` is meant to be committed —
 * so the token must not survive the read. Only URLs with a scheme are touched:
 * scp-like `git@github.com:acme/widget.git` is a bare username with no secret in
 * it, and stripping it would leave a remote nobody recognizes.
 *
 * Anything that is not a URL is returned unchanged; this is a redactor, not a
 * validator.
 */
export function stripRemoteCredentials(remote: string): string {
  const trimmed = remote.trim();
  const match = trimmed.match(/^([A-Za-z][A-Za-z0-9+.\-]*:\/\/)(?:[^/@]*@)?(.*)$/s);
  return match ? `${match[1]}${match[2]}` : trimmed;
}

/**
 * Split a remote into its host and path segments, covering the three forms git
 * accepts for a network remote:
 *
 *   - URL form, any scheme: `https://host/owner/repo.git`, `ssh://git@host:7999/PROJ/repo.git`
 *   - scp-style: `git@host:owner/repo.git` — a colon before the first slash
 *   - scheme-less URL: `host/owner/repo.git` is *not* accepted; git reads it as a path
 *
 * A port is dropped: it addresses the server, not the repository, so two remotes
 * differing only by port name the same repository.
 */
function splitRemote(remote: string): RawRemote | undefined {
  const trimmed = stripRemoteCredentials(remote).trim();
  if (!trimmed) return undefined;

  const url = trimmed.match(/^[A-Za-z][A-Za-z0-9+.\-]*:\/\/([^/:]+)(?::\d+)?\/(.*)$/s);
  // scp-style has a colon before any slash and no scheme. The host need not be
  // dotted: `git@work-github:acme/widget.git` names an SSH config alias and
  // `git@bitbucket:PROJ/widget.git` a short internal hostname, both of which git
  // resolves and both of which are real remotes. Only a single-letter host is
  // rejected — that is a Windows drive letter (`C:\src\repo`), which git reads
  // as a local path, and no host is one character long.
  const scp = url ? null : trimmed.match(/^(?:[^@/]+@)?([\w.\-]+):(?!\/)(.*)$/s);
  if (scp && /^[A-Za-z]$/.test(scp[1])) return undefined;

  const matched = url ?? scp;
  if (!matched) return undefined;

  const segments = matched[2]
    .replace(/\.git\/*$/, "")
    .split("/")
    .filter(Boolean);
  if (segments.length < 2) return undefined;

  return { host: matched[1], segments };
}

/**
 * Which hosting product serves this remote.
 *
 * Data Center is self-hosted, so there is no hostname to match on. Two signals
 * identify it, both structural rather than guessed: the `/scm/` prefix every DC
 * https clone URL carries, and a host whose first label is `bitbucket`, which
 * covers the ssh form (`ssh://git@bitbucket.example.com:7999/PROJ/repo.git`)
 * where the prefix is absent. A DC instance on a host named nothing in
 * particular, reached over ssh, is indistinguishable from any other git server
 * and is reported as `other`.
 */
function classifyHost(host: string, segments: string[]): RemoteHostKind {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (h === "github.com") return "github";
  if (h === "bitbucket.org") return "bitbucket-cloud";
  if (segments[0]?.toLowerCase() === "scm" && segments.length >= 3) return "bitbucket-dc";
  if (h.split(".")[0] === "bitbucket") return "bitbucket-dc";
  return "other";
}

/**
 * Parse a git remote URL into the repository it names.
 *
 * Answers `undefined` for anything that does not name a host and at least an
 * owner and a repository — a local path, a bare repository name, an empty
 * string. Never throws: identifying a repository is always incidental to the
 * caller's real work and must not fail it.
 *
 * Embedded credentials are dropped rather than returned, so a parsed remote is
 * safe to write to a committed artifact.
 */
export function parseGitRemoteUrl(remote: string): ParsedGitRemote | undefined {
  const raw = splitRemote(remote);
  if (!raw) return undefined;

  const kind = classifyHost(raw.host, raw.segments);
  // `scm` routes the clone on Data Center; it is not part of the repository's
  // identity, and keeping it would make the same repository parse differently
  // over https than over ssh.
  const identity = kind === "bitbucket-dc" && raw.segments[0]?.toLowerCase() === "scm"
    ? raw.segments.slice(1)
    : raw.segments;
  if (identity.length < 2) return undefined;

  const repo = identity[identity.length - 1];
  const owner = identity.slice(0, -1).join("/");

  return { host: raw.host, owner, repo, path: `${owner}/${repo}`, kind };
}

/**
 * Normalize a remote to a browsable base URL: `https://host/owner/repo`.
 *
 * Built from the path *as written*, so a Data Center remote keeps its `/scm/`
 * prefix — the instance redirects that to the repository page, whereas the
 * identity path would not resolve at all.
 *
 * The result is a base only. Callers that append a deep link (`/blob/<sha>/…`)
 * are using GitHub and GitLab syntax; Bitbucket spells the same thing `/src/`,
 * so a caller doing that on a non-`github`/`other` host should branch on `kind`.
 */
export function remoteToWebUrl(remote: string): string | undefined {
  const raw = splitRemote(remote);
  return raw ? `https://${raw.host}/${raw.segments.join("/")}` : undefined;
}
