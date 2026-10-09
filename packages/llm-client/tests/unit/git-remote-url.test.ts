/**
 * The one git-remote parser.
 *
 * Three readers depend on these answers agreeing — the iso export's source
 * links, the analysis manifest's repository identity, and the dashboard's
 * project header. The table below is the contract between them: one case per
 * host per URL form, so a change that fixes one host's ssh form and breaks
 * another's scp form cannot pass.
 */

import { describe, it, expect } from "vitest";
import {
  parseGitRemoteUrl,
  remoteToWebUrl,
  stripRemoteCredentials,
} from "../../src/git-remote-url.js";
import type { ParsedGitRemote } from "../../src/git-remote-url.js";

const GITHUB: Omit<ParsedGitRemote, "host"> & { host: string } = {
  host: "github.com",
  owner: "acme",
  repo: "widget",
  path: "acme/widget",
  kind: "github",
};

const BITBUCKET_CLOUD: ParsedGitRemote = {
  host: "bitbucket.org",
  owner: "acme",
  repo: "widget",
  path: "acme/widget",
  kind: "bitbucket-cloud",
};

const BITBUCKET_DC: ParsedGitRemote = {
  host: "bitbucket.example.com",
  owner: "PROJ",
  repo: "widget",
  path: "PROJ/widget",
  kind: "bitbucket-dc",
};

describe("parseGitRemoteUrl — three hosts, three forms", () => {
  describe("GitHub", () => {
    it("parses the https form", () => {
      expect(parseGitRemoteUrl("https://github.com/acme/widget.git")).toEqual(GITHUB);
    });

    it("parses the ssh form", () => {
      expect(parseGitRemoteUrl("ssh://git@github.com/acme/widget.git")).toEqual(GITHUB);
    });

    it("parses the scp-style form", () => {
      expect(parseGitRemoteUrl("git@github.com:acme/widget.git")).toEqual(GITHUB);
    });
  });

  describe("Bitbucket Cloud", () => {
    it("parses the https form", () => {
      expect(parseGitRemoteUrl("https://bitbucket.org/acme/widget.git")).toEqual(BITBUCKET_CLOUD);
    });

    it("parses the ssh form", () => {
      expect(parseGitRemoteUrl("ssh://git@bitbucket.org/acme/widget.git")).toEqual(BITBUCKET_CLOUD);
    });

    it("parses the scp-style form", () => {
      expect(parseGitRemoteUrl("git@bitbucket.org:acme/widget.git")).toEqual(BITBUCKET_CLOUD);
    });
  });

  describe("Bitbucket Data Center", () => {
    it("parses the https form, dropping the /scm/ clone prefix", () => {
      // `scm` routes the clone; the repository's identity is PROJ/widget, which
      // is what the ssh form below spells directly.
      expect(parseGitRemoteUrl("https://bitbucket.example.com/scm/PROJ/widget.git")).toEqual(
        BITBUCKET_DC,
      );
    });

    it("parses the ssh form, port and all", () => {
      expect(parseGitRemoteUrl("ssh://git@bitbucket.example.com:7999/PROJ/widget.git")).toEqual(
        BITBUCKET_DC,
      );
    });

    it("parses the scp-style form", () => {
      expect(parseGitRemoteUrl("git@bitbucket.example.com:PROJ/widget.git")).toEqual(BITBUCKET_DC);
    });
  });
});

describe("parseGitRemoteUrl — host kind", () => {
  it("distinguishes github.com, bitbucket.org and a self-hosted Data Center host", () => {
    expect(parseGitRemoteUrl("https://github.com/acme/widget")?.kind).toBe("github");
    expect(parseGitRemoteUrl("https://bitbucket.org/acme/widget")?.kind).toBe("bitbucket-cloud");
    expect(parseGitRemoteUrl("https://bitbucket.example.com/scm/PROJ/widget")?.kind).toBe(
      "bitbucket-dc",
    );
  });

  it("recognises Data Center by the /scm/ prefix on a host named anything", () => {
    // The only signal an https DC clone URL carries; the host is the customer's.
    expect(parseGitRemoteUrl("https://git.acme.internal/scm/PROJ/widget.git")).toEqual({
      host: "git.acme.internal",
      owner: "PROJ",
      repo: "widget",
      path: "PROJ/widget",
      kind: "bitbucket-dc",
    });
  });

  it("reports an unrecognised host as other rather than guessing", () => {
    // A wrong kind builds a host-specific URL that 404s; "other" makes the
    // caller fall back to something host-neutral.
    expect(parseGitRemoteUrl("https://gitlab.com/acme/widget.git")?.kind).toBe("other");
    expect(parseGitRemoteUrl("git@git.internal.example:group/sub/widget.git")?.kind).toBe("other");
  });

  it("does not mistake a lookalike host for the real one", () => {
    expect(parseGitRemoteUrl("https://github.com.evil.test/acme/widget")?.kind).toBe("other");
    expect(parseGitRemoteUrl("https://notbitbucket.org/acme/widget")?.kind).toBe("other");
  });

  it("treats a www-prefixed host as the host itself", () => {
    expect(parseGitRemoteUrl("https://www.github.com/acme/widget.git")?.kind).toBe("github");
  });
});

describe("parseGitRemoteUrl — owner and repo", () => {
  it("keeps a nested namespace whole, so owner + repo is always the path", () => {
    const parsed = parseGitRemoteUrl("git@git.internal.example:group/sub/widget.git");
    expect(parsed).toEqual({
      host: "git.internal.example",
      owner: "group/sub",
      repo: "widget",
      path: "group/sub/widget",
      kind: "other",
    });
    expect(`${parsed?.owner}/${parsed?.repo}`).toBe(parsed?.path);
  });

  it("parses a remote with no .git suffix", () => {
    expect(parseGitRemoteUrl("https://github.com/acme/widget")).toEqual(GITHUB);
  });

  it("ignores trailing slashes", () => {
    expect(parseGitRemoteUrl("https://github.com/acme/widget/")).toEqual(GITHUB);
    expect(parseGitRemoteUrl("https://github.com/acme/widget.git/")).toEqual(GITHUB);
  });

  it("keeps a repository name that merely contains .git", () => {
    expect(parseGitRemoteUrl("https://github.com/acme/dot.github")?.repo).toBe("dot.github");
  });
});

describe("parseGitRemoteUrl — what it refuses", () => {
  it("answers undefined rather than throwing for a string that names no repository", () => {
    for (const input of ["", "   ", "not-a-remote", "https://github.com/acme", "widget.git"]) {
      expect(parseGitRemoteUrl(input), input).toBeUndefined();
    }
  });

  it("does not read a Windows path as a host", () => {
    // `C:/src/widget` is a local path; parsing it as the host `C` would put a
    // drive letter in the manifest as a repository host. A one-character host
    // is the single shape the parser refuses outright, so cover each spelling
    // of a drive path that reaches it.
    expect(parseGitRemoteUrl("C:/src/widget")).toBeUndefined();
    expect(parseGitRemoteUrl("C:src/widget")).toBeUndefined();
    expect(parseGitRemoteUrl("d:/src/widget")).toBeUndefined();
    expect(parseGitRemoteUrl("C:\\src\\widget")).toBeUndefined();
  });
});

describe("parseGitRemoteUrl — hosts with no dot in them", () => {
  // git does not require a dotted host in a scp-style remote, and both of these
  // are ordinary origins: an alias resolved by the user's ssh config, and a
  // short internal hostname resolved by a search domain or hosts file. Refusing
  // them would blank the manifest's remote fields, drop the dashboard's parsed
  // repository name and lose the iso export's source links for anyone whose
  // origin is written that way.

  it("parses an SSH config alias as the host", () => {
    expect(parseGitRemoteUrl("git@work-github:acme/widget.git")).toEqual({
      host: "work-github",
      owner: "acme",
      repo: "widget",
      path: "acme/widget",
      kind: "other",
    });
  });

  it("parses a short internal hostname", () => {
    expect(parseGitRemoteUrl("git@bitbucket:PROJ/widget.git")).toEqual({
      host: "bitbucket",
      owner: "PROJ",
      repo: "widget",
      path: "PROJ/widget",
      kind: "bitbucket-dc",
    });
  });

  it("accepts localhost", () => {
    expect(parseGitRemoteUrl("git@localhost:acme/widget.git")?.host).toBe("localhost");
  });

  it("builds a browsable URL on an undotted host", () => {
    expect(remoteToWebUrl("git@work-github:acme/widget.git")).toBe(
      "https://work-github/acme/widget",
    );
  });
});

describe("a credentialed remote never survives parsing", () => {
  const SECRET = "ghp_livecredentialvalue";

  it("drops userinfo from a parsed remote", () => {
    const parsed = parseGitRemoteUrl(`https://sterling:${SECRET}@github.com/acme/widget.git`);
    expect(parsed).toEqual(GITHUB);
    expect(JSON.stringify(parsed)).not.toContain(SECRET);
  });

  it("drops userinfo from a web URL", () => {
    const url = remoteToWebUrl(`https://sterling:${SECRET}@github.com/acme/widget.git`);
    expect(url).toBe("https://github.com/acme/widget");
    expect(url).not.toContain(SECRET);
  });

  it("leaves a scp-style username alone — it is not a secret", () => {
    // Stripping it would leave a remote nobody recognises.
    expect(stripRemoteCredentials("git@github.com:acme/widget.git")).toBe(
      "git@github.com:acme/widget.git",
    );
  });

  it("returns a non-URL unchanged — it is a redactor, not a validator", () => {
    expect(stripRemoteCredentials("  not-a-remote  ")).toBe("not-a-remote");
  });
});

describe("remoteToWebUrl", () => {
  it("normalizes every form to the same browsable base", () => {
    for (const remote of [
      "git@github.com:acme/widget.git",
      "https://github.com/acme/widget.git",
      "ssh://git@github.com/acme/widget",
    ]) {
      expect(remoteToWebUrl(remote), remote).toBe("https://github.com/acme/widget");
    }
  });

  it("keeps Data Center's /scm/ prefix, which the instance redirects", () => {
    // The identity path (PROJ/widget) is not a URL the instance serves.
    expect(remoteToWebUrl("https://bitbucket.example.com/scm/PROJ/widget.git")).toBe(
      "https://bitbucket.example.com/scm/PROJ/widget",
    );
  });

  it("answers undefined for a remote it cannot parse", () => {
    expect(remoteToWebUrl("not-a-remote")).toBeUndefined();
    expect(remoteToWebUrl("")).toBeUndefined();
  });
});
