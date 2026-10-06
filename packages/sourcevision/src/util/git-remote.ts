/**
 * Reading the git remote, in one place.
 *
 * Two callers need the origin remote for different reasons — the iso export
 * turns it into browsable source links, and the analysis manifest records it
 * as the repository's identity so two analyses can be told apart once they
 * leave their own directory. They must agree on what the remote says, so the
 * parsing lives here and neither owns a second copy of it.
 *
 * Every function is safe on a directory that is not a git repository, has no
 * `origin`, or has no git binary on PATH: they answer `undefined` or `null`
 * rather than throwing. Discovering identity must never fail an analysis.
 *
 * @module sourcevision/util/git-remote
 */

import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import type { RepoIdentity } from "../schema/v1.js";

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

/** The `origin` remote URL as configured, or `undefined`. */
export function readOriginUrl(root: string): string | undefined {
  const url = gitCommand(root, ["config", "--get", "remote.origin.url"]);
  return url ? url : undefined;
}

/**
 * Normalize a git remote to a browsable base URL.
 * Handles `git@host:owner/repo.git` and `https://host/owner/repo.git`.
 */
export function remoteToWebUrl(remote: string): string | undefined {
  const cleaned = remote.trim().replace(/\.git$/, "");
  const ssh = cleaned.match(/^[\w.-]+@([\w.-]+):(.+)$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const https = cleaned.match(/^https?:\/\/(?:[^@/]+@)?([\w.-]+\/.+)$/);
  if (https) return `https://${https[1]}`;
  return undefined;
}

/** A remote split into the host serving it and the path on that host. */
export interface RemoteParts {
  /** Host only, no scheme or credentials: `github.com`, `bitbucket.org`. */
  host: string;
  /** Path on the host, no leading slash and no `.git`: `owner/repo`. */
  path: string;
}

/**
 * Split a remote into host and path.
 *
 * Host-neutral by construction — the host is whatever the remote names, so
 * GitHub, Bitbucket and a self-hosted GitLab all parse the same way. Any
 * embedded credentials in an https remote are dropped rather than carried
 * into the manifest.
 */
export function parseRemote(remote: string): RemoteParts | undefined {
  const web = remoteToWebUrl(remote);
  if (!web) return undefined;
  const match = web.match(/^https:\/\/([\w.-]+)\/(.+)$/);
  if (!match) return undefined;
  const path = match[2].replace(/\/+$/, "");
  if (!path) return undefined;
  return { host: match[1], path };
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
