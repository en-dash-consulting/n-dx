/**
 * Reading the git remote, in one place.
 *
 * Two callers need the origin remote for different reasons — the iso export
 * turns it into browsable source links, and the analysis manifest records it
 * as the repository's identity so two analyses can be told apart once they
 * leave their own directory. They must agree on what the remote says, so
 * reading it lives here and neither owns a second copy of it.
 *
 * *Interpreting* the URL is not this module's job: `parseGitRemoteUrl` and
 * friends live in `@n-dx/llm-client`, the one tier both sourcevision and the
 * web dashboard can reach, and are re-exported below so this module stays the
 * single import site for sourcevision. This module owns the process boundary —
 * running git — and nothing else.
 *
 * Every function is safe on a directory that is not a git repository, has no
 * `origin`, or has no git binary on PATH: they answer `undefined` or `null`
 * rather than throwing. Discovering identity must never fail an analysis.
 *
 * A credentialed remote never leaves this module: `readOriginUrl` redacts the
 * URL userinfo, so neither the manifest nor the iso export can record a token.
 *
 * @module sourcevision/util/git-remote
 */

import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import {
  parseGitRemoteUrl,
  remoteToWebUrl,
  stripRemoteCredentials,
} from "@n-dx/llm-client";
import type { RepoIdentity } from "../schema/v1.js";

/**
 * Re-exported so sourcevision's callers keep one import site for everything to
 * do with the remote, while there is still only one implementation of the
 * parsing itself (`@n-dx/llm-client`'s `git-remote-url.ts`).
 */
export { parseGitRemoteUrl, remoteToWebUrl, stripRemoteCredentials };
export type { ParsedGitRemote, RemoteHostKind } from "@n-dx/llm-client";

/**
 * Run a git command in `root`, or answer `undefined`.
 *
 * stderr is discarded and the call is capped at five seconds: a hung git (a
 * credential prompt on a misconfigured remote, a network filesystem) must not
 * stall an analysis.
 */
export function gitCommand(root: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
  } catch {
    return undefined;
  }
}

/** True when `root` is inside a git work tree. */
export function isGitWorkTree(root: string): boolean {
  return gitCommand(root, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

/**
 * The `origin` remote URL, with any embedded credentials removed.
 *
 * Redaction happens here rather than at each call site so no caller can hold
 * the credentialed form by accident. Nothing downstream performs a git
 * operation with this value — it is recorded and displayed — so losing the
 * userinfo costs nothing.
 */
export function readOriginUrl(root: string): string | undefined {
  const url = gitCommand(root, ["config", "--get", "remote.origin.url"]);
  return url ? stripRemoteCredentials(url) : undefined;
}

/** A remote split into the host serving it and the path on that host. */
export interface RemoteParts {
  /** Host only, no scheme or credentials: `github.com`, `bitbucket.org`. */
  host: string;
  /** Path on the host, no leading slash and no `.git`: `owner/repo`. */
  path: string;
}

/**
 * The host-and-path projection of a parsed remote, which is all the manifest
 * records. `parseGitRemoteUrl` is the parser; this narrows its answer to the
 * two fields `RepoIdentity` carries.
 */
export function parseRemote(remote: string): RemoteParts | undefined {
  const parsed = parseGitRemoteUrl(remote);
  return parsed ? { host: parsed.host, path: parsed.path } : undefined;
}

/**
 * The repository's default branch, read locally from `origin/HEAD`.
 *
 * `git symbolic-ref` is a local lookup with no network call. It is unset in a
 * fresh or `--single-branch` clone, which answers `null` rather than guessing
 * a name — a wrong default branch is worse than an absent one.
 */
export function readDefaultBranch(root: string): string | null {
  const ref = gitCommand(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (!ref) return null;
  const slash = ref.indexOf("/");
  return slash === -1 ? ref : ref.slice(slash + 1);
}

/**
 * Identify the repository at `root`.
 *
 * Always answers a populated identity. A directory with no remote, or no git
 * at all, still gets a `name` from its own directory name with the remote
 * fields `null` — a consumer can then tell "no remote" from "not analysed"
 * without a second lookup.
 *
 * `remoteUrl` is the redacted remote, not the raw config value: the manifest
 * is a committed artifact and must not carry a credential.
 */
export function readRepoIdentity(root: string): RepoIdentity {
  const absRoot = resolve(root);
  const fallbackName = basename(absRoot);
  const remoteUrl = isGitWorkTree(absRoot) ? readOriginUrl(absRoot) : undefined;

  if (!remoteUrl) {
    return {
      name: fallbackName,
      remoteUrl: null,
      remoteHost: null,
      remotePath: null,
      defaultBranch: readDefaultBranch(absRoot),
    };
  }

  const parts = parseRemote(remoteUrl);
  const nameFromRemote = parts ? parts.path.split("/").filter(Boolean).pop() : undefined;

  return {
    name: nameFromRemote || fallbackName,
    remoteUrl,
    remoteHost: parts?.host ?? null,
    remotePath: parts?.path ?? null,
    defaultBranch: readDefaultBranch(absRoot),
  };
}

export type { RepoIdentity };
