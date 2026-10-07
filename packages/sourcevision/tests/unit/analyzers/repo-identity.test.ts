/**
 * Repo identity on the analysis manifest.
 *
 * `targetPath` is a local path, so it cannot tell two analyses apart once they
 * leave their own directory. `manifest.repo` is what can. The rules under test:
 * the identity is always populated, `name` falls back to the directory when
 * there is no remote, the remote is read by exactly one helper — the same one
 * the iso export uses for its source links — and a credential embedded in
 * that remote never reaches the manifest.
 *
 * Real git repositories in a temp directory rather than a mocked `execFileSync`:
 * the thing being tested is what git actually reports, and a mock would only
 * assert that the code calls the arguments the code calls.
 *
 * @see src/util/git-remote.ts
 * @see src/analyzers/manifest.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseRemote,
  readRepoIdentity,
  remoteToWebUrl,
  stripRemoteCredentials,
} from "../../../src/util/git-remote.js";
import { readManifest } from "../../../src/analyzers/manifest.js";
import { ManifestSchema } from "../../../src/schema/validate.js";
import { validate } from "../../../src/schema/validate.js";

let root: string;
/** A git repo whose origin is an ssh remote. */
let withRemote: string;
/** A git repo with no remote configured at all. */
let withoutRemote: string;
/** A plain directory that was never `git init`ed. */
let notGit: string;
/** A git repo whose origin is an https remote with a token baked into it. */
let withCredentialedRemote: string;

/** The secret in `withCredentialedRemote`'s origin; must reach no artifact. */
const SECRET = "ghp-do-not-commit-me";

function git(dir: string, args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: ["ignore", "ignore", "ignore"] });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "sv-repo-identity-"));

  withRemote = join(root, "checkout-with-remote");
  await mkdir(withRemote);
  git(withRemote, ["init", "-q"]);
  git(withRemote, ["remote", "add", "origin", "git@github.com:acme/widget-service.git"]);

  withoutRemote = join(root, "local-only-repo");
  await mkdir(withoutRemote);
  git(withoutRemote, ["init", "-q"]);

  notGit = join(root, "just-a-folder");
  await mkdir(notGit);

  withCredentialedRemote = join(root, "checkout-with-token");
  await mkdir(withCredentialedRemote);
  git(withCredentialedRemote, ["init", "-q"]);
  git(withCredentialedRemote, [
    "remote",
    "add",
    "origin",
    `https://sterling:${SECRET}@github.com/acme/widget.git`,
  ]);
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("readRepoIdentity — remote present", () => {
  it("names the repository from the remote path, not the directory", () => {
    const repo = readRepoIdentity(withRemote);
    // The directory is "checkout-with-remote"; the repository is "widget-service".
    expect(repo.name).toBe("widget-service");
  });

  it("records the remote, its host and its path", () => {
    const repo = readRepoIdentity(withRemote);
    expect(repo.remoteUrl).toBe("git@github.com:acme/widget-service.git");
    expect(repo.remoteHost).toBe("github.com");
    expect(repo.remotePath).toBe("acme/widget-service");
  });
});

describe("readRepoIdentity — remote absent", () => {
  it("still produces a populated identity with remoteUrl null", () => {
    const repo = readRepoIdentity(withoutRemote);
    expect(repo.remoteUrl).toBeNull();
    expect(repo.remoteHost).toBeNull();
    expect(repo.remotePath).toBeNull();
    expect(repo.name).toBe("local-only-repo");
  });

  it("reports no default branch rather than guessing one", () => {
    // origin/HEAD is unset without a remote; a guessed "main" would be a
    // wrong answer dressed as a known one.
    expect(readRepoIdentity(withoutRemote).defaultBranch).toBeNull();
  });
});

describe("readRepoIdentity — not a git directory", () => {
  it("falls back to the directory name with every remote field null", () => {
    const repo = readRepoIdentity(notGit);
    expect(repo).toEqual({
      name: "just-a-folder",
      remoteUrl: null,
      remoteHost: null,
      remotePath: null,
      defaultBranch: null,
    });
  });

  it("does not throw", () => {
    expect(() => readRepoIdentity(join(root, "does-not-exist"))).not.toThrow();
  });
});

describe("remote parsing is host-neutral", () => {
  const CASES: Array<[string, { host: string; path: string }]> = [
    ["git@github.com:acme/widget.git", { host: "github.com", path: "acme/widget" }],
    ["https://github.com/acme/widget.git", { host: "github.com", path: "acme/widget" }],
    ["git@bitbucket.org:team/widget.git", { host: "bitbucket.org", path: "team/widget" }],
    ["https://bitbucket.org/team/widget", { host: "bitbucket.org", path: "team/widget" }],
    ["git@git.internal.example:group/sub/widget.git", {
      host: "git.internal.example", path: "group/sub/widget",
    }],
  ];

  for (const [remote, expected] of CASES) {
    it(`parses ${remote}`, () => {
      expect(parseRemote(remote)).toEqual(expected);
    });
  }

  it("drops credentials embedded in an https remote", () => {
    const parts = parseRemote("https://user:token@github.com/acme/widget.git");
    expect(parts).toEqual({ host: "github.com", path: "acme/widget" });
    expect(JSON.stringify(parts)).not.toContain("token");
  });

  it("answers undefined for a remote it cannot parse", () => {
    expect(parseRemote("not-a-remote")).toBeUndefined();
    expect(parseRemote("")).toBeUndefined();
  });
});

describe("one implementation of the remote reader", () => {
  it("is the same normalizer the iso export uses for source links", async () => {
    // The iso export re-exports rather than re-implementing; if it ever grows
    // a second copy, these stop being the same function.
    const isoSources = await import("../../../src/export/iso-sources.js");
    expect(isoSources.remoteToWebUrl).toBe(remoteToWebUrl);
  });
});

describe("a credentialed remote never reaches the artifact", () => {
  // .sourcevision/manifest.json is designed to be committed, so a token in
  // the configured origin must not survive the read. parseRemote already
  // dropped userinfo for host/path; remoteUrl used to carry it through.
  it("stores the remote with its userinfo removed", () => {
    const repo = readRepoIdentity(withCredentialedRemote);
    expect(repo.remoteUrl).toBe("https://github.com/acme/widget.git");
  });

  it("leaves no trace of the credential anywhere in the identity", () => {
    const repo = readRepoIdentity(withCredentialedRemote);
    expect(JSON.stringify(repo)).not.toContain(SECRET);
    expect(JSON.stringify(repo)).not.toContain("sterling");
  });

  it("still names the repository and its host from the remote", () => {
    const repo = readRepoIdentity(withCredentialedRemote);
    expect(repo.name).toBe("widget");
    expect(repo.remoteHost).toBe("github.com");
    expect(repo.remotePath).toBe("acme/widget");
  });

  it("keeps the credential out of the manifest that gets committed", () => {
    const manifest = readManifest(withCredentialedRemote);
    expect(JSON.stringify(manifest)).not.toContain(SECRET);
    expect(manifest.repo?.remoteUrl).toBe("https://github.com/acme/widget.git");
  });
});

describe("stripRemoteCredentials", () => {
  const CASES: Array<[string, string]> = [
    ["https://user:token@github.com/acme/widget.git", "https://github.com/acme/widget.git"],
    ["https://token@github.com/acme/widget.git", "https://github.com/acme/widget.git"],
    ["ssh://git@github.com/acme/widget.git", "ssh://github.com/acme/widget.git"],
    ["https://oauth2:tok@git.internal.example:8443/g/sub/widget.git",
      "https://git.internal.example:8443/g/sub/widget.git"],
    // No userinfo to drop — unchanged.
    ["https://github.com/acme/widget.git", "https://github.com/acme/widget.git"],
    // scp-like syntax has no password field; "git@" is the recognizable form
    // of an ssh remote, not a secret, so it is left alone.
    ["git@github.com:acme/widget.git", "git@github.com:acme/widget.git"],
    // Not a URL at all: a redactor, not a validator.
    ["../sibling-repo", "../sibling-repo"],
    ["", ""],
  ];

  for (const [input, expected] of CASES) {
    it(`redacts ${input || "(empty)"}`, () => {
      expect(stripRemoteCredentials(input)).toBe(expected);
    });
  }

  it("is applied by readRepoIdentity, not only exported", () => {
    // Guards against the redactor drifting out of the read path.
    expect(readRepoIdentity(withCredentialedRemote).remoteUrl).toBe(
      stripRemoteCredentials(`https://sterling:${SECRET}@github.com/acme/widget.git`)
    );
  });
});

describe("manifest carries the identity", () => {
  it("populates repo on a fresh manifest", () => {
    const manifest = readManifest(withRemote);
    expect(manifest.repo).toEqual({
      name: "widget-service",
      remoteUrl: "git@github.com:acme/widget-service.git",
      remoteHost: "github.com",
      remotePath: "acme/widget-service",
      defaultBranch: null,
    });
  });

  it("populates repo even where there is no remote", () => {
    const manifest = readManifest(withoutRemote);
    expect(manifest.repo?.remoteUrl).toBeNull();
    expect(manifest.repo?.name).toBe("local-only-repo");
  });

  it("validates with the identity present", () => {
    expect(validate(ManifestSchema, readManifest(withRemote)).ok).toBe(true);
  });
});

describe("manifests written before repo identity existed", () => {
  // The field is optional precisely so an older analysis keeps validating;
  // this is the fixture that would have been written then, unchanged.
  const PRE_CHANGE_MANIFEST = {
    schemaVersion: "1.0.0",
    toolVersion: "0.7.1",
    analyzedAt: "2026-01-01T00:00:00.000Z",
    gitSha: "abc123",
    gitBranch: "main",
    targetPath: "/abs/some/project",
    modules: { inventory: { status: "complete", completedAt: "2026-01-01T00:00:01.000Z" } },
  };

  it("validates unchanged", () => {
    const result = validate(ManifestSchema, PRE_CHANGE_MANIFEST);
    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors.issues)).toBe(true);
  });

  it("is accepted with repo absent rather than null", () => {
    expect(validate(ManifestSchema, { ...PRE_CHANGE_MANIFEST, repo: undefined }).ok).toBe(true);
  });
});

describe("the identity schema", () => {
  const VALID = {
    name: "widget",
    remoteUrl: null,
    remoteHost: null,
    remotePath: null,
    defaultBranch: null,
  };
  const BASE = {
    schemaVersion: "1.0.0",
    toolVersion: "0.8.0",
    analyzedAt: "2026-01-01T00:00:00.000Z",
    targetPath: "/abs/project",
    modules: {},
  };

  it("accepts every remote field as null", () => {
    expect(validate(ManifestSchema, { ...BASE, repo: VALID }).ok).toBe(true);
  });

  it("rejects an identity with no name", () => {
    expect(validate(ManifestSchema, { ...BASE, repo: { ...VALID, name: "" } }).ok).toBe(false);
  });

  it("rejects a remote field that is simply missing", () => {
    const { remoteHost: _omitted, ...withoutHost } = VALID;
    expect(validate(ManifestSchema, { ...BASE, repo: withoutHost }).ok).toBe(false);
  });
});
